import type { ChainAdapter } from "@alpharadar/chain";
import type { PrismaClient } from "@alpharadar/database";
import type { Address, Hex } from "viem";

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
  tokenName: string | null;
  tokenSymbol: string | null;
  mintTransactionHash: Hex;
  mintBlockNumber: bigint;
  /** wei paid for the mint transaction — 0n means free. */
  mintValue: bigint;
}

export interface IngestResult {
  nftMintSignals: NftMintSignal[];
  /** Total candidate addresses pulled from discovery this run, before the known/type/mint filters. */
  candidatesScanned: number;
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
 * Slice 1's one detector: a new ERC-721 contract appearing on the chain,
 * plus its first mint activity. Discovery via
 * ChainAdapter.getRecentContractCreations — direct RPC block scanning, in
 * chain order, including unverified deployments. Replaces the earlier
 * Blockscout getRecentlyVerifiedContracts feed, which structurally missed
 * exactly the contracts an early-detection product needs to see first
 * (verification is optional, usually delayed by days, and something scam
 * deployers essentially never do). Mint detection via Transfer logs from
 * the zero address (09 §11 point 4 / project brief) is unchanged.
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
 */
export async function ingest(
  chainAdapter: ChainAdapter,
  prisma: IngestPrisma,
  params: IngestParams,
): Promise<IngestResult> {
  const signals: NftMintSignal[] = [];

  const creations = await chainAdapter.getRecentContractCreations(params.fromBlock, params.toBlock);
  const candidateAddresses: Address[] = creations.map((creation) => creation.address);

  for (const address of candidateAddresses) {
    const known = await prisma.contract.findUnique({
      where: { chain_address: { chain: params.chain, address } },
    });
    if (known) continue;

    const tokenMetadata = await chainAdapter.getTokenMetadata(address);
    if (tokenMetadata?.type !== "ERC-721") continue;

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

    signals.push({
      contractAddress: address,
      tokenName: tokenMetadata.name,
      tokenSymbol: tokenMetadata.symbol,
      mintTransactionHash: firstMint.transactionHash,
      mintBlockNumber: firstMint.blockNumber,
      mintValue: mintTransaction?.value ?? 0n,
    });
  }

  return { nftMintSignals: signals, candidatesScanned: candidateAddresses.length };
}
