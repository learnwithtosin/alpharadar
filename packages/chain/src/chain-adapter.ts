import type { Address, Hex } from "viem";
import type {
  AddressTransaction,
  ChainBlock,
  ChainLog,
  ChainMetadata,
  ChainTransaction,
  ChainTransactionReceipt,
  ContractVerification,
  GetLogsParams,
  PagedResult,
  PageParams,
  TokenHolder,
  TokenMetadata,
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

  getBlock(blockNumber: bigint): Promise<ChainBlock>;
  getTransaction(hash: Hex): Promise<ChainTransaction | null>;
  getReceipt(hash: Hex): Promise<ChainTransactionReceipt | null>;
  getContractCode(address: Address): Promise<Hex>;
  getAddressBalance(address: Address): Promise<bigint>;

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
}
