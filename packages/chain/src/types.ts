import type { Address, Hex } from "viem";

/**
 * Domain types returned by ChainAdapter. Deliberately not viem's own
 * `Block`/`Transaction`/`Log` types — those are RPC-shaped and
 * viem-specific. 01-PROJECT-CONSTITUTION.md §17 and
 * 02-MVP-TECHNICAL-SPECIFICATION.md §8 require the adapter boundary to keep
 * chain-specific implementation out of domain logic; leaking viem's
 * generic-heavy types into the interface would defeat that.
 */

export interface ChainMetadata {
  chainId: number;
  name: string;
  nativeCurrencySymbol: string;
  rpcUrl: string;
}

export interface ChainBlock {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  /** Unix seconds. */
  timestamp: bigint;
  transactionHashes: Hex[];
}

export interface ChainTransaction {
  hash: Hex;
  blockNumber: bigint | null;
  from: Address;
  to: Address | null;
  value: bigint;
  input: Hex;
  nonce: number;
}

export interface ChainTransactionReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  status: "success" | "reverted";
  contractAddress: Address | null;
  gasUsed: bigint;
  logs: ChainLog[];
}

export interface ChainLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface GetLogsParams {
  fromBlock: bigint;
  toBlock: bigint;
  address?: Address | Address[];
  /**
   * Raw eth_getLogs topic filter: each array position is a topic slot
   * (topics[0] is typically the event signature); a slot's value is a
   * single topic hex, an OR-list of hexes, or null to match any value in
   * that slot. viem's high-level `getLogs` action does not expose this
   * (only ABI-typed `event`/`events`, confirmed against viem 2.56.3's own
   * types) — RobinhoodAdapter implements it via the unformatted
   * `client.request()` escape hatch instead. Confirmed applied server-side
   * against live Robinhood Chain data: an address-only query returned 7
   * Transfer logs for a token; adding
   * `topics: [TRANSFER_SIG, ZERO_ADDRESS_TOPIC, null]` narrowed that to
   * exactly the 1 real mint log, not a client-side no-op.
   */
  topics?: (Hex | Hex[] | null)[];
}

// ---------------------------------------------------------------------------
// Indexer reads — 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §2.2. Backed by
// the Blockscout v2 REST API in RobinhoodAdapter, not RPC.
// ---------------------------------------------------------------------------

export interface TokenMetadata {
  address: Address;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
  holdersCount: number | null;
  /** Raw indexer value, e.g. "ERC-20" / "ERC-721" / "ERC-1155". */
  type: string | null;
}

export interface TokenHolder {
  holderAddress: Address;
  value: bigint;
  /** Set for ERC-721/1155 holdings; null for fungible ERC-20 balances. */
  tokenId: string | null;
}

export interface AddressTransaction {
  hash: Hex;
  blockNumber: number;
  /** ISO 8601, as returned by the indexer. */
  timestamp: string | null;
  from: Address;
  to: Address | null;
  value: bigint;
  status: "ok" | "error" | "unknown";
  methodName: string | null;
}

/**
 * One item from the newest-verified-first feed backing
 * getRecentlyVerifiedContracts. Deliberately thin — callers that need full
 * verification detail (compiler, language, source) call
 * getContractVerification for that specific address.
 */
export interface VerifiedContractSummary {
  address: Address;
  name: string | null;
  /** ISO 8601. */
  verifiedAt: string | null;
}

/**
 * One contract-creation transaction found by scanning block receipts
 * directly via RPC (`getRecentContractCreations`) — chain-order, includes
 * unverified deployments, unlike `VerifiedContractSummary`.
 */
export interface ContractCreation {
  address: Address;
  creatorAddress: Address;
  transactionHash: Hex;
  blockNumber: bigint;
}

export interface ContractVerification {
  isVerified: boolean;
  name: string | null;
  compilerVersion: string | null;
  language: string | null;
  /** ISO 8601. */
  verifiedAt: string | null;
}

/**
 * Blockscout's `next_page_params` is an opaque bag of scalar values specific
 * to each endpoint (observed: `{block_number, index, items_count}` for
 * address transactions). Treated as opaque here and passed back verbatim as
 * query params on the next call — do not assume its keys.
 */
export type PageCursor = Record<string, string | number>;

export interface PageParams {
  cursor?: PageCursor;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: PageCursor | null;
}
