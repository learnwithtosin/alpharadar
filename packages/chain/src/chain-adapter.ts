import type { Address, Hex } from "viem";
import type {
  AddressTransaction,
  ChainBlock,
  ChainLog,
  ChainMetadata,
  ChainTransaction,
  ChainTransactionReceipt,
  ContractCreation,
  ContractVerification,
  GetLogsParams,
  PagedResult,
  PageParams,
  TokenHolder,
  TokenMetadata,
  VerifiedContractSummary,
} from "./types.js";

/**
 * Chain-agnostic read interface. 02-MVP-TECHNICAL-SPECIFICATION.md §8 and
 * 01-PROJECT-CONSTITUTION.md §17: application code depends on this
 * interface, never on a specific chain's RPC/indexer calls directly.
 * RobinhoodAdapter is the only implementation in the MVP — no other chain,
 * no transaction signing, read-only methods only.
 */
export interface ChainAdapter {
  getChainMetadata(): Promise<ChainMetadata>;

  /** Current chain head. Needed by PollingDriver to compute a run's block range. */
  getLatestBlockNumber(): Promise<bigint>;

  getBlock(blockNumber: bigint): Promise<ChainBlock>;
  getTransaction(hash: Hex): Promise<ChainTransaction | null>;
  getReceipt(hash: Hex): Promise<ChainTransactionReceipt | null>;
  getContractCode(address: Address): Promise<Hex>;
  getAddressBalance(address: Address): Promise<bigint>;

  /**
   * Raw storage-slot read (eth_getStorageAt). Used for on-chain risk
   * signals that need a specific known slot (e.g. the EIP-1967 proxy
   * implementation slot) rather than an ABI-decoded value — deliberately a
   * thin passthrough, not an interpretation, matching getContractCode's
   * "give the raw bytes, let the caller decide" shape.
   */
  getStorageAt(address: Address, slot: Hex): Promise<Hex>;

  /**
   * Reads Ownable's `owner()` (OpenZeppelin's de facto standard, not a
   * real ERC). Returns null when the call reverts — no such function,
   * which is a normal, expected outcome for a non-Ownable contract, not an
   * error — rather than the zero address, so "not Ownable" and
   * "ownership renounced to the zero address" (a real, meaningful, and
   * different fact) are never confused.
   */
  getContractOwner(address: Address): Promise<Address | null>;

  /** Filtered by address/topics and chunked internally — never a bare full-range scan. */
  getLogs(params: GetLogsParams): Promise<ChainLog[]>;

  /**
   * Not implemented in the MVP (docs/spec/09-INFRASTRUCTURE-DECISION.md §11)
   * — the pipeline is driven by a scheduled PollingDriver instead. Declared
   * on the interface now so that adding it later, once a StreamingDriver is
   * built, doesn't require touching every consumer. Returns an unsubscribe
   * function.
   */
  subscribeToBlocks(onBlock: (block: ChainBlock) => void): Promise<() => void>;

  // Indexer reads — 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §2.2.
  getTokenMetadata(address: Address): Promise<TokenMetadata | null>;
  getTokenHolders(address: Address, params?: PageParams): Promise<PagedResult<TokenHolder>>;
  getAddressTransactions(
    address: Address,
    params?: PageParams,
  ): Promise<PagedResult<AddressTransaction>>;
  getContractVerification(address: Address): Promise<ContractVerification>;

  /**
   * Verified-contracts feed (Blockscout /v2/smart-contracts, newest-verified
   * first). No longer used for discovery — see getRecentContractCreations.
   * Verification is optional, usually delayed by days, and something scam
   * deployers essentially never do, so this feed structurally misses
   * exactly the contracts an early-detection product needs to see first.
   * Confirmed live and kept for whatever still legitimately needs a
   * verified-contract listing (it is not dead — just not the discovery
   * source).
   */
  getRecentlyVerifiedContracts(params?: PageParams): Promise<PagedResult<VerifiedContractSummary>>;

  /**
   * New-contract discovery, in chain order, including unverified
   * deployments — replaces getRecentlyVerifiedContracts as the discovery
   * source. Scans every block in [fromBlock, toBlock] via one
   * eth_getBlockByNumber call per block, plus one eth_getTransactionReceipt
   * call per contract-creation candidate found in that block (a
   * transaction with `to === null`) — not for every transaction. Returns
   * every successful contract creation found (receipt.contractAddress !==
   * null, status success).
   *
   * Historical note — an earlier design used one eth_getBlockReceipts call
   * per block instead. That method returns every receipt in the block
   * (all logs included) and, on Alchemy, is priced at 500 throughput CU
   * versus 20 for eth_getBlockByNumber and 20 for
   * eth_getTransactionReceipt — a 25x difference that shows up directly as
   * throttling. Measured live on the authenticated endpoint over an
   * identical 600-block range: eth_getBlockReceipts ran at 0.78 blocks/sec
   * with 18 of 600 calls taking 7-29s each; eth_getBlockByNumber +
   * selective eth_getTransactionReceipt ran the same range at 2.83
   * blocks/sec with zero calls over 5s, finding the same 3 contract
   * creations. See docs/decisions/0011-discovery-method-switch.md.
   *
   * Deliberately one block per RPC call, not batched. Confirmed live
   * against this chain's public RPC (original eth_getBlockReceipts
   * design): a single isolated JSON-RPC batch of up to 29 requests in one
   * HTTP call succeeds (30 fails immediately, consistently — a hard
   * batch-size or burst-budget ceiling). But *sustained* batching does not
   * hold up: two batches of 29 fired back-to-back, and repeated batches of
   * only 5, both exhausted the underlying rate budget within one or two
   * calls and triggered a lockout that did not clear within 60s of
   * continued (paced) retries. The only approach proven safe under
   * sustained load is plain sequential, unbatched calls at natural network
   * pace. Callers must size fromBlock/toBlock accordingly (see
   * checkpoint.ts's getNextRange for the accepted per-run block window)
   * rather than assume this can be sped up with batching.
   */
  getRecentContractCreations(fromBlock: bigint, toBlock: bigint): Promise<ContractCreation[]>;
}
