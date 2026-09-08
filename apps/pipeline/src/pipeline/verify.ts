import type { ChainAdapter } from "@alpharadar/chain";
import type { Opportunity, PrismaClient } from "@alpharadar/database";
import type { Address, Hex } from "viem";
import {
  assessConcentrationRisk,
  assessContractRisk,
  assessDeployerRisk,
  bytecodeContainsAnySelector,
  combineOverallRisk,
  MINT_FUNCTION_SELECTORS,
  PAUSE_OR_BLACKLIST_FUNCTION_SELECTORS,
} from "@alpharadar/scoring";
import { log } from "../logger.js";

type VerifyPrisma = Pick<
  PrismaClient,
  "opportunity" | "contract" | "riskAssessment" | "source" | "evidence" | "opportunityEvent"
>;

const ZERO_ADDRESS = ("0x" + "0".repeat(40)) as Address;
/** keccak256("eip1967.proxy.implementation") - 1 — confirmed by computing it, not typed from memory. */
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const ZERO_SLOT = ("0x" + "0".repeat(64)) as Hex;

/**
 * Runs `fn`, returning null instead of throwing. Every chain/indexer read
 * in this module is wrapped in this — 01-PROJECT-CONSTITUTION.md §8:
 * unknown information stays unknown, never fabricated to fill a field.
 * Distinct from ingest.ts's per-candidate catch (which recovers at the
 * *candidate* level, discarding the whole candidate on failure): here a
 * single failed read degrades exactly one field to UNKNOWN, everything
 * else this function learns still gets recorded.
 */
async function safe<T>(fn: () => Promise<T>, label: string, address: string): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    log.info("verify.read.unknown", {
      label,
      address,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface EvidenceInput {
  claim: string;
  evidenceType: "FACT" | "INFERENCE" | "UNKNOWN";
  confidence?: number;
}

/**
 * 04 Phase 4 / 09 §6's "verify" stage: contract source verification and
 * deployer identity from Blockscout; deployer age and prior-deployment
 * count; bytecode/ownership/proxy signals for contractRisk; holder
 * concentration for concentrationRisk (08 §4.1). Writes one Source row per
 * run plus an Evidence row per claim (01 §8 — FACT/INFERENCE/UNKNOWN, never
 * fabricated), a RiskAssessment row, and a VERIFIED OpportunityEvent.
 *
 * liquidityRisk, socialRisk and linkRisk are always UNKNOWN — no DEX
 * integration or off-chain sources exist in the MVP
 * (docs/decisions/0006-risk-and-token-page-unknowns.md).
 */
export async function verify(
  opportunityId: string,
  chainAdapter: ChainAdapter,
  prisma: VerifyPrisma,
): Promise<void> {
  const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const chainMeta = await chainAdapter.getChainMetadata();
  const evidence: EvidenceInput[] = [];

  if (!opportunity.chain || !opportunity.contractAddress) {
    // Not contract-anchored (e.g. a future manually-entered opportunity
    // type, per docs/decisions/0003) — nothing on-chain to check.
    evidence.push({
      claim: "This opportunity has no associated contract address to verify.",
      evidenceType: "UNKNOWN",
    });
    await persist(prisma, opportunity, chainMeta.explorerUrl, evidence, {
      overallRisk: "UNKNOWN",
      contractRisk: "UNKNOWN",
      concentrationRisk: "UNKNOWN",
      deployerRisk: "UNKNOWN",
      reasons: ["no contract address associated with this opportunity"],
    });
    return;
  }

  const chain = opportunity.chain;
  const address = opportunity.contractAddress as Address;

  const contract = await prisma.contract.findUnique({
    where: { chain_address: { chain, address } },
  });
  if (!contract) {
    throw new Error(
      `verify(${opportunityId}): no Contract row for ${chain}/${address} — resolve() should have created one`,
    );
  }

  // --- source verification -------------------------------------------------
  const verification = await safe(
    () => chainAdapter.getContractVerification(address),
    "verification",
    address,
  );
  if (verification) {
    evidence.push({
      claim: verification.isVerified
        ? "Contract source code is verified on Blockscout."
        : "Contract source code is not verified on Blockscout.",
      evidenceType: "FACT",
      confidence: 1,
    });
    if (verification.isVerified !== contract.verified) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { verified: verification.isVerified },
      });
    }
  } else {
    evidence.push({
      claim: "Contract source verification status could not be determined.",
      evidenceType: "UNKNOWN",
    });
  }
  const sourceVerified = verification?.isVerified ?? null;

  // --- deployer identity — captured at discovery time via the creation
  // receipt's `from` field (RPC, a FACT), not re-derived from Blockscout:
  // strictly more reliable, and we already have it. ------------------------
  if (contract.deployerAddress) {
    evidence.push({
      claim: `Contract was deployed by ${contract.deployerAddress}.`,
      evidenceType: "FACT",
      confidence: 1,
    });
  } else {
    evidence.push({ claim: "Deployer address is unknown.", evidenceType: "UNKNOWN" });
  }

  // --- deployer age: only trusted when Blockscout returns the deployer's
  // *entire* transaction history in a single page — otherwise we cannot
  // honestly claim to know the earliest one. --------------------------------
  let deployerAgeMs: number | null = null;
  if (contract.deployerAddress) {
    const deployerAddress = contract.deployerAddress as Address;
    const history = await safe(
      () => chainAdapter.getAddressTransactions(deployerAddress),
      "deployerHistory",
      deployerAddress,
    );
    if (history && history.nextCursor === null && history.items.length > 0) {
      const timestamps = history.items
        .map((tx) => (tx.timestamp ? Date.parse(tx.timestamp) : null))
        .filter((t): t is number => t !== null);
      if (timestamps.length > 0) {
        const earliest = Math.min(...timestamps);
        deployerAgeMs = Date.now() - earliest;
        evidence.push({
          claim: `Deployer address' earliest observed activity was ${new Date(earliest).toISOString()}.`,
          evidenceType: "FACT",
          confidence: 1,
        });
      }
    }
    if (deployerAgeMs === null) {
      evidence.push({
        claim: "Deployer address age could not be determined.",
        evidenceType: "UNKNOWN",
      });
    }
  }

  // --- prior deployment count: our own DB, always available, honestly
  // scoped to "observed by this pipeline" — not exhaustive. -----------------
  const priorDeploymentCount = contract.deployerAddress
    ? await prisma.contract.count({
        where: { chain, deployerAddress: contract.deployerAddress, id: { not: contract.id } },
      })
    : null;
  if (priorDeploymentCount !== null) {
    evidence.push({
      claim: `This deployer has ${priorDeploymentCount} other contract(s) observed by this pipeline.`,
      evidenceType: "FACT",
      confidence: 0.7, // honest partial confidence — undercounts anything deployed before this pipeline started watching
    });
  }

  // --- bytecode signals ------------------------------------------------------
  const bytecode = await safe(() => chainAdapter.getContractCode(address), "bytecode", address);
  const hasMintFunction = bytecodeContainsAnySelector(bytecode, MINT_FUNCTION_SELECTORS);
  const hasPauseOrBlacklistFunction = bytecodeContainsAnySelector(
    bytecode,
    PAUSE_OR_BLACKLIST_FUNCTION_SELECTORS,
  );

  // --- ownership --------------------------------------------------------------
  const owner = await safe(() => chainAdapter.getContractOwner(address), "owner", address);
  const ownershipRenounced = owner === null ? null : owner.toLowerCase() === ZERO_ADDRESS;
  if (owner !== null) {
    evidence.push({
      claim: ownershipRenounced
        ? "Contract ownership has been renounced (owner is the zero address)."
        : `Contract has an active owner: ${owner}.`,
      evidenceType: "FACT",
      confidence: 1,
    });
  }

  // --- proxy/upgradeable -------------------------------------------------------
  const implementationSlot = await safe(
    () => chainAdapter.getStorageAt(address, EIP1967_IMPLEMENTATION_SLOT),
    "proxySlot",
    address,
  );
  const isProxy =
    implementationSlot === null ? null : implementationSlot.toLowerCase() !== ZERO_SLOT;
  if (isProxy !== null) {
    evidence.push({
      claim: isProxy
        ? "Contract is an EIP-1967 upgradeable proxy."
        : "Contract's EIP-1967 implementation slot is empty (not a known proxy pattern).",
      evidenceType: "FACT",
      confidence: isProxy ? 1 : 0.6, // absence of this one slot doesn't rule out every other proxy pattern
    });
  }

  const contractRisk = assessContractRisk({
    sourceVerified,
    hasMintFunction,
    hasPauseOrBlacklistFunction,
    ownershipRenounced,
    isProxy,
  });

  // --- holder concentration — ERC-20 only in this slice (see completion
  // report): our RPC-based getTokenMetadata always sets totalSupply null
  // for ERC-721, so there is no reliable denominator for NFT concentration
  // yet. ------------------------------------------------------------------
  let concentrationRisk = assessConcentrationRisk({ topHoldersValue: null, totalSupply: null });
  if (contract.contractType === "ERC20") {
    const [holders, tokenMetadata] = await Promise.all([
      safe(() => chainAdapter.getTokenHolders(address), "holders", address),
      safe(() => chainAdapter.getTokenMetadata(address), "tokenMetadataForSupply", address),
    ]);
    const topHoldersValue = holders
      ? holders.items.slice(0, 10).reduce((sum, holder) => sum + holder.value, 0n)
      : null;
    concentrationRisk = assessConcentrationRisk({
      topHoldersValue,
      totalSupply: tokenMetadata?.totalSupply ?? null,
    });
    if (holders) {
      evidence.push({
        claim: `Top-10 holders were fetched (${holders.items.length} holder(s) returned).`,
        evidenceType: "FACT",
        confidence: 1,
      });
    } else {
      evidence.push({
        claim: "Token holder distribution could not be determined.",
        evidenceType: "UNKNOWN",
      });
    }
  }

  const deployerRisk = assessDeployerRisk({ deployerAgeMs, priorDeploymentCount });

  const overallRisk = combineOverallRisk([
    contractRisk.level,
    concentrationRisk.level,
    deployerRisk.level,
  ]);

  await persist(prisma, opportunity, chainMeta.explorerUrl, evidence, {
    overallRisk,
    contractRisk: contractRisk.level,
    concentrationRisk: concentrationRisk.level,
    deployerRisk: deployerRisk.level,
    reasons: [...contractRisk.reasons, ...concentrationRisk.reasons, ...deployerRisk.reasons],
  });
}

interface RiskToPersist {
  overallRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  contractRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  concentrationRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  deployerRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: string[];
}

async function persist(
  prisma: VerifyPrisma,
  opportunity: Opportunity,
  explorerUrl: string,
  evidence: EvidenceInput[],
  risk: RiskToPersist,
): Promise<void> {
  const source = await prisma.source.create({
    data: {
      type: opportunity.contractAddress ? "BLOCKCHAIN_EXPLORER" : "ON_CHAIN",
      url: opportunity.contractAddress
        ? `${explorerUrl}/address/${opportunity.contractAddress}`
        : `${explorerUrl}`,
      title: "verify() pass",
      publisher: "Blockscout / on-chain RPC",
    },
  });

  for (const item of evidence) {
    await prisma.evidence.create({
      data: {
        opportunityId: opportunity.id,
        sourceId: source.id,
        claim: item.claim,
        evidenceType: item.evidenceType,
        confidence: item.confidence ?? null,
      },
    });
  }

  await prisma.riskAssessment.create({
    data: {
      opportunityId: opportunity.id,
      overallRisk: risk.overallRisk,
      contractRisk: risk.contractRisk,
      concentrationRisk: risk.concentrationRisk,
      deployerRisk: risk.deployerRisk,
      liquidityRisk: "UNKNOWN",
      socialRisk: "UNKNOWN",
      linkRisk: "UNKNOWN",
      reasons: risk.reasons,
    },
  });

  await prisma.opportunityEvent.create({
    data: {
      opportunityId: opportunity.id,
      eventType: "VERIFIED",
      payload: { overallRisk: risk.overallRisk },
    },
  });
}
