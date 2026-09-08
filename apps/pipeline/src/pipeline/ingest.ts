import type { ChainAdapter } from "@alpharadar/chain";
import type { PrismaClient } from "@alpharadar/database";
import type { Address, Hex } from "viem";
import { log } from "../logger.js";

/**
 * keccak256("Transfer(address,address,uint256)") — the standard ERC-721
 * (and ERC-20) Transfer event signature. Confirmed live against Robinhood
 * Chain: filtering eth_getLogs by this as topics[0] plus the zero address
 * as topics[1] narrows a real token's logs down to exactly its mint(s),
 * not a client-side no-op (see packages/chain's getLogs).
 */
const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/** address(0) left-padded to a 32-byte topic. */
const ZERO_ADDRESS_TOPIC = ("0x" + "0".repeat(64)) as Hex;

export interface NftMintSignal {
  contractAddress: Address;
  /** The `from` of the contract-creation transaction — a FACT from the creation receipt, not an inference. */
  deployerAddress: Address;
  deployedAtBlock: bigint;
  tokenName: string | null;
  tokenSymbol: string | null;
  mintTransactionHash: Hex;
  mintBlockNumber: bigint;
  /** wei paid for the mint transaction — 0n means free. */
  mintValue: bigint;
}

/**
 * A newly-deployed ERC-20 with its first observed on-chain activity — a
 * mint (Transfer from the zero address, typically the constructor minting
 * initial supply) or an ordinary transfer, whichever comes first. See
 * docs/decisions/0008-erc20-launch-detection.md: a live base-rate survey
 * found ~166 contract creations/hour on this chain but 0 ERC-721/hour
 * across a 3-hour sample, versus real (if rare) ERC-20 activity — Slice 1
 * targets this instead of NFT mints for that reason.
 */
export interface Erc20LaunchSignal {
  contractAddress: Address;
  /** The `from` of the contract-creation transaction — a FACT from the creation receipt, not an inference. */
  deployerAddress: Address;
  deployedAtBlock: bigint;
  tokenName: string | null;
  tokenSymbol: string | null;
  activityTransactionHash: Hex;
  activityBlockNumber: bigint;
  /** wei sent with the first-activity transaction — usually 0n for a plain transfer. */
  activityValue: bigint;
}

export interface IngestResult {
  nftMintSignals: NftMintSignal[];
  tokenLaunchSignals: Erc20LaunchSignal[];
  /** Total candidate addresses pulled from discovery this run, before the known/type/activity filters. */
  candidatesScanned: number;
  /** Candidates whose enrichment (classification/log/tx lookup) threw — degraded to unknown, not fatal. See the per-candidate try/catch below. */
  candidatesFailed: number;
}

export interface IngestParams {
  fromBlock: bigint;
  toBlock: bigint;
  chain: string;
}

type IngestPrisma = Pick<PrismaClient, "contract">;

function sortLogsByPosition<T extends { blockNumber: bigint; logIndex: number }>(logs: T[]): T[] {
  return [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}

/**
 * Slice 1's detectors: primarily a new ERC-20 with its first activity
 * (mint or transfer) — see Erc20LaunchSignal's doc comment for why this,
 * not NFT mints, is the active target. The ERC-721-new-contract-plus-mint
 * detector from the original Slice 1 is kept fully intact alongside it,
 * unconditionally, so NFT activity is caught the moment it exists on this
 * chain without any further code changes — it just hasn't fired in the
 * base-rate survey's sample.
 *
 * Discovery via ChainAdapter.getRecentContractCreations — direct RPC block
 * scanning, in chain order, including unverified deployments. Replaces the
 * earlier Blockscout getRecentlyVerifiedContracts feed, which structurally
 * missed exactly the contracts an early-detection product needs to see
 * first (verification is optional, usually delayed by days, and something
 * scam deployers essentially never do).
 *
 * Discovery is bounded to [params.fromBlock, params.toBlock] — a run
 * deliberately scans only its checkpoint-assigned window and does not
 * backfill beyond it (see checkpoint.ts's getNextRange); a contract
 * created before that window is permanently missed by discovery, not
 * queued for later.
 *
 * Purely read-and-return — no Opportunity/Project/Contract writes happen
 * here. That's resolve()'s job (04 Phase 4's "opportunity-resolution"
 * scope), keeping this stage's only side effect a single read against
 * Contract (to skip already-known addresses).
 *
 * Per-candidate enrichment (classification, log lookup, tx lookup) is
 * wrapped in try/catch: one candidate's call throwing degrades that
 * candidate to unknown (skipped, logged, counted in candidatesFailed) and
 * the loop continues — it does not abort the run. Losing one contract's
 * metadata is not a reason to abandon the rest of a scanned block window;
 * only a failure in discovery itself (getRecentContractCreations, not
 * inside this loop) is treated as unrecoverable and propagates, leaving
 * the checkpoint unadvanced so the same range is retried.
 */
export async function ingest(
  chainAdapter: ChainAdapter,
  prisma: IngestPrisma,
  params: IngestParams,
): Promise<IngestResult> {
  const nftMintSignals: NftMintSignal[] = [];
  const tokenLaunchSignals: Erc20LaunchSignal[] = [];
  let candidatesFailed = 0;

  const creations = await chainAdapter.getRecentContractCreations(params.fromBlock, params.toBlock);
  const candidateAddresses: Address[] = creations.map((creation) => creation.address);
  const creationByAddress = new Map(creations.map((creation) => [creation.address, creation]));

  for (const address of candidateAddresses) {
    try {
      const known = await prisma.contract.findUnique({
        where: { chain_address: { chain: params.chain, address } },
      });
      if (known) continue;

      // Always present — address came from this same creations array.
      const creation = creationByAddress.get(address)!;

      const tokenMetadata = await chainAdapter.getTokenMetadata(address);

      if (tokenMetadata?.type === "ERC-721") {
        const mintLogs = await chainAdapter.getLogs({
          fromBlock: params.fromBlock,
          toBlock: params.toBlock,
          address,
          topics: [TRANSFER_EVENT_TOPIC, ZERO_ADDRESS_TOPIC, null],
        });
        if (mintLogs.length === 0) continue;

        const [firstMint] = sortLogsByPosition(mintLogs);
        if (!firstMint) continue;

        const mintTransaction = await chainAdapter.getTransaction(firstMint.transactionHash);

        nftMintSignals.push({
          contractAddress: address,
          deployerAddress: creation.creatorAddress,
          deployedAtBlock: creation.blockNumber,
          tokenName: tokenMetadata.name,
          tokenSymbol: tokenMetadata.symbol,
          mintTransactionHash: firstMint.transactionHash,
          mintBlockNumber: firstMint.blockNumber,
          mintValue: mintTransaction?.value ?? 0n,
        });
      } else if (tokenMetadata?.type === "ERC-20") {
        // "First mint or transfer activity" — a mint-from-zero is itself a
        // Transfer event, so an unrestricted topics[1]/[2] filter catches
        // both in one query rather than needing a separate mint-specific
        // check the way the ERC-721 branch does.
        const activityLogs = await chainAdapter.getLogs({
          fromBlock: params.fromBlock,
          toBlock: params.toBlock,
          address,
          topics: [TRANSFER_EVENT_TOPIC, null, null],
        });
        if (activityLogs.length === 0) continue;

        const [firstActivity] = sortLogsByPosition(activityLogs);
        if (!firstActivity) continue;

        const activityTransaction = await chainAdapter.getTransaction(
          firstActivity.transactionHash,
        );

        tokenLaunchSignals.push({
          contractAddress: address,
          deployerAddress: creation.creatorAddress,
          deployedAtBlock: creation.blockNumber,
          tokenName: tokenMetadata.name,
          tokenSymbol: tokenMetadata.symbol,
          activityTransactionHash: firstActivity.transactionHash,
          activityBlockNumber: firstActivity.blockNumber,
          activityValue: activityTransaction?.value ?? 0n,
        });
      }
    } catch (error) {
      candidatesFailed++;
      log.error("ingest.candidate.failed", error, { address, chain: params.chain });
    }
  }

  return {
    nftMintSignals,
    tokenLaunchSignals,
    candidatesScanned: candidateAddresses.length,
    candidatesFailed,
  };
}
