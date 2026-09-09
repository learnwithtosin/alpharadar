/**
 * =====================================================================
 *  DEVELOPMENT TOOLING — not part of the production pipeline.
 *  Not invoked by run-pipeline.ts, resolve.ts, or any cron job.
 * =====================================================================
 *
 * Inserts one realistic test Opportunity (NFT_MINT) so the Telegram alert
 * path can be exercised — rendered against real data, not placeholders —
 * without waiting for a live launch to be detected and scored.
 *
 * The underlying contract is real: "Ponsino Pass" (PONS), a genuine
 * ERC-721 deployed on Robinhood Chain, found via a live
 * getRecentContractCreations + getTokenMetadata scan against the
 * production RPC (same code path apps/pipeline's discovery stage uses) —
 * see docs/decisions/0012-telegram-alert-stage.md for how/when this was
 * found. The Project/Opportunity wrapping it is fabricated by this
 * script, not a real detection — every row it writes is marked
 * `isTestData: true` (a real, queryable column — see the schema comment
 * on Project.isTestData/Opportunity.isTestData) and prefixed "[DEV TEST]"
 * in its name/title, so it can't be mistaken for a real one either by
 * filtering or by inspection.
 *
 * The score/risk are computed by the real @alpharadar/scoring functions
 * from plausible risk inputs (chosen for this script, not independently
 * verified against this specific contract's actual bytecode/holders) —
 * so the resulting score/urgency are exactly what the real pipeline
 * would compute from those inputs, not a hand-picked number.
 *
 * Idempotent: re-running finds the existing test project by slug rather
 * than creating a duplicate.
 *
 * Usage: pnpm seed-test-opportunity
 */
import { ROBINHOOD_CHAIN_SLUG } from "@alpharadar/chain";
import { getEnv } from "@alpharadar/config";
import { prisma } from "@alpharadar/database";
import {
  assessConcentrationRisk,
  assessContractRisk,
  assessDeployerRisk,
  combineOverallRisk,
  computeScore,
  type ScoreInputs,
} from "@alpharadar/scoring";
import type { RiskLevel } from "@alpharadar/types";

const REAL_CONTRACT = {
  address: "0x4599FE72D1d9c5b390708C14Bc49e3c0eeb0487b",
  deployerAddress: "0x00635341344EF562868612dB6492cF80E5046112",
  deployedAtBlock: 58462472n,
  name: "Ponsino Pass",
  symbol: "PONS",
} as const;

const TEST_MARKER = "[DEV TEST]";

function riskLevelToScore(level: Exclude<RiskLevel, "UNKNOWN">): number {
  // Same mapping as score.ts's own riskLevelToScore — kept local rather
  // than shared, since it's three lines and score.ts doesn't export it.
  return { LOW: 20, MEDIUM: 45, HIGH: 70, CRITICAL: 95 }[level];
}

async function main(): Promise<void> {
  getEnv(); // fail fast if DATABASE_URL etc. aren't configured, same as any other entry point

  const slug = `dev-test-${REAL_CONTRACT.address.toLowerCase()}`;

  const existingProject = await prisma.project.findUnique({ where: { slug } });
  if (existingProject) {
    const existingOpportunity = await prisma.opportunity.findFirst({
      where: { projectId: existingProject.id },
    });
    if (existingOpportunity) {
      console.info(
        `[dev tooling] Test opportunity already exists — not creating a duplicate.\n` +
          `[dev tooling] Opportunity id: ${existingOpportunity.id}\n` +
          `[dev tooling] Run: pnpm send-alert ${existingOpportunity.id}`,
      );
      return;
    }
  }

  const project =
    existingProject ??
    (await prisma.project.create({
      data: {
        name: `${TEST_MARKER} ${REAL_CONTRACT.name}`,
        symbol: REAL_CONTRACT.symbol,
        slug,
        chain: ROBINHOOD_CHAIN_SLUG,
        projectType: "NFT_COLLECTION",
        status: "ACTIVE",
        description:
          "Seeded by `pnpm seed-test-opportunity` — development tooling, not a real discovery. Safe to delete.",
        isTestData: true,
      },
    }));

  await prisma.contract.upsert({
    where: {
      chain_address: { chain: ROBINHOOD_CHAIN_SLUG, address: REAL_CONTRACT.address },
    },
    update: {},
    create: {
      projectId: project.id,
      chain: ROBINHOOD_CHAIN_SLUG,
      address: REAL_CONTRACT.address,
      contractType: "ERC721",
      deployerAddress: REAL_CONTRACT.deployerAddress,
    },
  });

  // Plausible risk inputs for a real ERC-721 mint contract — chosen to be
  // a believable, moderate case (not a spotless zero-risk fixture), run
  // through the real scoring package rather than hand-picked directly.
  const contractRisk = assessContractRisk({
    sourceVerified: true,
    hasMintFunction: true,
    hasPauseOrBlacklistFunction: false,
    ownershipRenounced: false,
    isProxy: false,
  });
  const totalSupply = 10_000n; // plausible NFT collection size
  const concentrationRisk = assessConcentrationRisk({
    topHoldersValue: (totalSupply * 15n) / 100n, // top-10 holders own ~15%
    totalSupply,
  });
  const deployerRisk = assessDeployerRisk({
    deployerAgeMs: 2 * 24 * 60 * 60 * 1000, // 2 days
    priorDeploymentCount: 0,
  });
  const overallRisk = combineOverallRisk([
    contractRisk.level,
    concentrationRisk.level,
    deployerRisk.level,
  ]);

  const now = new Date();
  const scoreInputs: ScoreInputs = {
    contractRiskLevel: contractRisk.level,
    concentrationRiskLevel: concentrationRisk.level,
    isFree: false, // NFT_MINT (paid), not FREE_MINT — matches the entryCost below
    detectedAt: now,
    now,
    smartWalletSignalCount: 0,
    hasDeadline: false,
  };
  const scoreResult = computeScore(scoreInputs);

  const opportunity = await prisma.opportunity.create({
    data: {
      projectId: project.id,
      type: "NFT_MINT",
      actionProfile: "MINT",
      title: `${TEST_MARKER} ${REAL_CONTRACT.name} mint detected`,
      description:
        "Seeded by `pnpm seed-test-opportunity` — development tooling, not a real discovery.",
      status: "ACTIVE",
      score: scoreResult.score,
      riskScore: overallRisk === "UNKNOWN" ? null : riskLevelToScore(overallRisk),
      urgency: scoreResult.urgency,
      detectedAt: now,
      entryCost: "0.05",
      currency: "ETH",
      chain: ROBINHOOD_CHAIN_SLUG,
      contractAddress: REAL_CONTRACT.address,
      scoreInputs: {
        contractRiskLevel: scoreInputs.contractRiskLevel,
        concentrationRiskLevel: scoreInputs.concentrationRiskLevel,
        isFree: scoreInputs.isFree,
        detectedAt: now.toISOString(),
        now: now.toISOString(),
        smartWalletSignalCount: scoreInputs.smartWalletSignalCount,
        hasDeadline: scoreInputs.hasDeadline,
      },
      scoringVersion: scoreResult.scoringVersion,
      isTestData: true,
    },
  });

  await prisma.riskAssessment.create({
    data: {
      opportunityId: opportunity.id,
      overallRisk,
      contractRisk: contractRisk.level,
      concentrationRisk: concentrationRisk.level,
      deployerRisk: deployerRisk.level,
      liquidityRisk: "UNKNOWN",
      socialRisk: "UNKNOWN",
      linkRisk: "UNKNOWN",
      reasons: [...contractRisk.reasons, ...concentrationRisk.reasons, ...deployerRisk.reasons],
    },
  });

  console.info(
    `[dev tooling] Created test opportunity for ${REAL_CONTRACT.name} (${REAL_CONTRACT.symbol}).\n` +
      `[dev tooling] Opportunity id: ${opportunity.id}\n` +
      `[dev tooling] score=${scoreResult.score} urgency=${scoreResult.urgency} overallRisk=${overallRisk}\n` +
      `[dev tooling] Run: pnpm send-alert ${opportunity.id}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[dev tooling] seed-test-opportunity failed:", error);
    process.exit(1);
  });
