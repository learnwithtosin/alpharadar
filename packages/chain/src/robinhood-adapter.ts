import {
  createPublicClient,
  getAddress,
  hexToBigInt,
  hexToNumber,
  http,
  numberToHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { BlockscoutClient, type BlockscoutClientOptions } from "./blockscout-client.js";
import type { ChainAdapter } from "./chain-adapter.js";
import { chunkBlockRange } from "./chunk-block-range.js";
import { NotImplementedError } from "./errors.js";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "./robinhood-chain-definition.js";
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

export interface RobinhoodAdapterOptions {
  rpcUrl: string;
  explorerApiUrl: string;
  /** Default 1000 — mirrors POLL_BLOCK_CHUNK_SIZE in docs/spec/09-INFRASTRUCTURE-DECISION.md §9. */
  pollBlockChunkSize?: bigint;
  rpcRetryCount?: number;
  blockscoutOptions?: Partial<Omit<BlockscoutClientOptions, "baseUrl">>;
  /** Test-only: inject a viem client instead of creating one from rpcUrl. */
  publicClient?: PublicClient;
  /** Test-only: inject a BlockscoutClient instead of creating one from explorerApiUrl. */
  blockscoutClient?: BlockscoutClient;
}

// ---------------------------------------------------------------------------
// Raw Blockscout v2 response shapes — the subset of fields actually used,
// confirmed live against https://robinhoodchain.blockscout.com/api. Numeric
// fields (decimals, holders_count, value, block_number) come back as JSON
// strings, not numbers, except block_number on the transactions list, which
// is a JSON number. See the probe findings in the completion report.
// ---------------------------------------------------------------------------

interface RawAddressRef {
  hash: string;
}

interface RawTokenResponse {
  address_hash: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  total_supply: string | null;
  holders_count: string | null;
  type: string | null;
}

interface RawTokenHolderItem {
  address: RawAddressRef;
  token_id: string | null;
  value: string;
}

interface RawTokenHoldersResponse {
  items: RawTokenHolderItem[];
  next_page_params: Record<string, string | number> | null;
}

interface RawAddressTransactionItem {
  hash: string;
  block_number: number;
  timestamp: string | null;
  from: RawAddressRef;
  to: RawAddressRef | null;
  value: string;
  status: string | null;
  method: string | null;
}

interface RawAddressTransactionsResponse {
  items: RawAddressTransactionItem[];
  next_page_params: Record<string, string | number> | null;
}

interface RawSmartContractResponse {
  is_verified: boolean;
  name: string | null;
  compiler_version: string | null;
  language: string | null;
  verified_at: string | null;
}

interface RawSmartContractListItem {
  address: RawAddressRef & { name: string | null };
  verified_at: string | null;
}

interface RawSmartContractListResponse {
  items: RawSmartContractListItem[];
  next_page_params: Record<string, string | number> | null;
}

/**
 * The unformatted shape a raw `eth_getBlockReceipts` JSON-RPC response
 * actually has — same hex-string-for-every-quantity convention as
 * eth_getLogs (see RawEthGetLogsLog above). Confirmed live.
 */
interface RawBlockReceiptItem {
  contractAddress: string | null;
  status: Hex;
  transactionHash: Hex;
  blockNumber: Hex;
  from: string;
}

/**
 * The unformatted shape a raw `eth_getLogs` JSON-RPC response actually has
 * — confirmed live: every quantity field comes back as a hex string, not a
 * number, unlike viem's high-level `getLogs` action (which formats them).
 */
interface RawEthGetLogsLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  removed: boolean;
}

function toChainLog(log: Log): ChainLog {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
    throw new Error(`Received a pending log with a null blockNumber/transactionHash/logIndex`);
  }
  return {
    address: log.address,
    topics: [...log.topics],
    data: log.data,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}

function toChainLogFromRaw(log: RawEthGetLogsLog): ChainLog {
  return {
    address: getAddress(log.address),
    topics: [...log.topics],
    data: log.data,
    blockNumber: hexToBigInt(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex),
  };
}

function toAddressTransactionStatus(status: string | null): AddressTransaction["status"] {
  if (status === "ok" || status === "error") return status;
  return "unknown";
}

/**
 * Read-only. No transaction signing, ever — see 01-PROJECT-CONSTITUTION.md
 * §2/§3. RPC reads go through viem against ROBINHOOD_RPC_URL; indexer reads
 * go through the Blockscout v2 REST API against ROBINHOOD_EXPLORER_API_URL.
 * The only adapter for the only chain in the MVP (01 §17).
 */
export class RobinhoodAdapter implements ChainAdapter {
  private readonly publicClient: PublicClient;
  private readonly blockscout: BlockscoutClient;
  private readonly chunkSize: bigint;
  private readonly rpcUrl: string;

  constructor(options: RobinhoodAdapterOptions) {
    this.rpcUrl = options.rpcUrl;
    this.chunkSize = options.pollBlockChunkSize ?? 1000n;
    this.publicClient =
      options.publicClient ??
      createPublicClient({
        chain: robinhoodChain,
        transport: http(options.rpcUrl, {
          // The public RPC is documented as rate limited (08 §2.3); viem's
          // http transport already retries with backoff on 429/5xx, so RPC
          // calls don't need a hand-rolled retry loop the way Blockscout does.
          retryCount: options.rpcRetryCount ?? 5,
        }),
      });
    this.blockscout =
      options.blockscoutClient ??
      new BlockscoutClient({
        baseUrl: options.explorerApiUrl,
        ...options.blockscoutOptions,
      });
  }

  async getChainMetadata(): Promise<ChainMetadata> {
    return {
      chainId: ROBINHOOD_CHAIN_ID,
      name: robinhoodChain.name,
      nativeCurrencySymbol: robinhoodChain.nativeCurrency.symbol,
      rpcUrl: this.rpcUrl,
    };
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async getBlock(blockNumber: bigint): Promise<ChainBlock> {
    const block = await this.publicClient.getBlock({ blockNumber });
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      transactionHashes: block.transactions as Hex[],
    };
  }

  async getTransaction(hash: Hex): Promise<ChainTransaction | null> {
    try {
      const tx = await this.publicClient.getTransaction({ hash });
      return {
        hash: tx.hash,
        blockNumber: tx.blockNumber,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        input: tx.input,
        nonce: tx.nonce,
      };
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return null;
      throw error;
    }
  }

  async getReceipt(hash: Hex): Promise<ChainTransactionReceipt | null> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash });
      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        contractAddress: receipt.contractAddress ?? null,
        gasUsed: receipt.gasUsed,
        logs: receipt.logs.map(toChainLog),
      };
    } catch (error) {
      if (
        error instanceof TransactionReceiptNotFoundError ||
        error instanceof TransactionNotFoundError
      ) {
        return null;
      }
      throw error;
    }
  }

  async getContractCode(address: Address): Promise<Hex> {
    const code = await this.publicClient.getCode({ address });
    return code ?? "0x";
  }

  async getAddressBalance(address: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /**
   * Chunked by pollBlockChunkSize and fetched sequentially, never in
   * parallel — the shared public RPC is rate limited (confirmed live: a
   * rapid burst of getLogs calls got a real 429 from this endpoint, not
   * just from Blockscout) and a confirmed hard cap of 50,000 matched logs
   * per call means an unfiltered range fails fast; callers should always
   * pass an address filter, and should pass topics when they only care
   * about a specific event (09 §5: mint detection needs Transfer logs
   * filtered to `from == zero address`).
   *
   * Goes through `client.request()`, not the high-level `getLogs` action —
   * that action has no topics parameter (confirmed against viem 2.56.3's
   * own types: only ABI-typed `event`/`events`, or address-only). The raw
   * method requires fromBlock/toBlock as hex strings, not viem's own
   * declared `BlockNumber = bigint` type for this schema entry — passing a
   * bigint through client.request() would serialize as a bare decimal
   * string (viem's JSON stringifier does `bigint.toString()`, not hex),
   * which real nodes reject. Confirmed live, both that hex-encoding here
   * is required and that server-side topic filtering actually narrows
   * results (not a client-side no-op): an address-only query returned 7
   * real Transfer logs for a token; adding a
   * `[TRANSFER_SIG, ZERO_ADDRESS_TOPIC, null]` filter narrowed that to
   * exactly the 1 real mint log. request() also returns every quantity as
   * an unformatted hex string, unlike the high-level action — hand-parsed
   * in toChainLogFromRaw. Reorg'd logs (removed: true) are dropped; they
   * shouldn't occur for a finalized block range, but the field exists on
   * the wire and a caller must never treat a removed log as real.
   */
  async getLogs(params: GetLogsParams): Promise<ChainLog[]> {
    const ranges = chunkBlockRange(params.fromBlock, params.toBlock, this.chunkSize);
    const allLogs: ChainLog[] = [];

    for (const range of ranges) {
      const rawLogs = (await this.publicClient.request({
        method: "eth_getLogs",
        params: [
          {
            address: params.address,
            topics: params.topics,
            fromBlock: numberToHex(range.fromBlock),
            toBlock: numberToHex(range.toBlock),
          },
        ],
        // eth_getLogs' actual wire params (hex-string block bounds, raw
        // topics) don't match viem's declared PublicRpcSchema entry for
        // this method closely enough to satisfy it without a cast — see
        // the comment above for what was confirmed live instead of assumed.
      } as unknown as Parameters<PublicClient["request"]>[0])) as unknown as RawEthGetLogsLog[];

      allLogs.push(...rawLogs.filter((log) => !log.removed).map(toChainLogFromRaw));
    }

    return allLogs;
  }

  async subscribeToBlocks(_onBlock: (block: ChainBlock) => void): Promise<() => void> {
    throw new NotImplementedError(
      "RobinhoodAdapter.subscribeToBlocks is not implemented in this slice. " +
        "Ingestion is driven by a scheduled PollingDriver instead — see " +
        "docs/spec/09-INFRASTRUCTURE-DECISION.md §11 for the upgrade path.",
    );
  }

  async getTokenMetadata(address: Address): Promise<TokenMetadata | null> {
    const result = await this.blockscout.get<RawTokenResponse>(`/v2/tokens/${address}`, {
      okOn404: true,
    });
    if (result === null) return null;

    return {
      address,
      name: result.name,
      symbol: result.symbol,
      decimals: result.decimals !== null ? Number(result.decimals) : null,
      totalSupply: result.total_supply !== null ? BigInt(result.total_supply) : null,
      holdersCount: result.holders_count !== null ? Number(result.holders_count) : null,
      type: result.type,
    };
  }

  async getTokenHolders(address: Address, params?: PageParams): Promise<PagedResult<TokenHolder>> {
    const result = await this.blockscout.get<RawTokenHoldersResponse>(
      `/v2/tokens/${address}/holders`,
      { query: params?.cursor },
    );
    if (result === null) return { items: [], nextCursor: null };

    return {
      items: result.items.map((item) => ({
        holderAddress: item.address.hash as Address,
        value: BigInt(item.value),
        tokenId: item.token_id,
      })),
      nextCursor: result.next_page_params,
    };
  }

  async getAddressTransactions(
    address: Address,
    params?: PageParams,
  ): Promise<PagedResult<AddressTransaction>> {
    const result = await this.blockscout.get<RawAddressTransactionsResponse>(
      `/v2/addresses/${address}/transactions`,
      { query: params?.cursor },
    );
    if (result === null) return { items: [], nextCursor: null };

    return {
      items: result.items.map((item) => ({
        hash: item.hash as Hex,
        blockNumber: item.block_number,
        timestamp: item.timestamp,
        from: item.from.hash as Address,
        to: item.to?.hash as Address | null,
        value: BigInt(item.value),
        status: toAddressTransactionStatus(item.status),
        methodName: item.method,
      })),
      nextCursor: result.next_page_params,
    };
  }

  /**
   * Three confirmed outcomes: 200 with a full verification record; 404
   * "Not found" for a valid-format address that is unverified or not a
   * contract (returns isVerified: false, not an error); 422 for a
   * malformed address string (BlockscoutClient throws, since okOn404 only
   * suppresses 404).
   */
  async getContractVerification(address: Address): Promise<ContractVerification> {
    const result = await this.blockscout.get<RawSmartContractResponse>(
      `/v2/smart-contracts/${address}`,
      { okOn404: true },
    );

    if (result === null) {
      return {
        isVerified: false,
        name: null,
        compilerVersion: null,
        language: null,
        verifiedAt: null,
      };
    }

    return {
      isVerified: result.is_verified,
      name: result.name,
      compilerVersion: result.compiler_version,
      language: result.language,
      verifiedAt: result.verified_at,
    };
  }

  /**
   * Confirmed live: no sort param needed or accepted for this — the
   * default order is already newest-verified-first. (Contrast
   * getTokenMetadata's sibling /v2/tokens list, which defaults to
   * holders_count/market-cap order and has no recency sort at all.)
   */
  async getRecentlyVerifiedContracts(
    params?: PageParams,
  ): Promise<PagedResult<VerifiedContractSummary>> {
    const result = await this.blockscout.get<RawSmartContractListResponse>("/v2/smart-contracts", {
      query: params?.cursor,
    });
    if (result === null) return { items: [], nextCursor: null };

    return {
      items: result.items.map((item) => ({
        address: item.address.hash as Address,
        name: item.address.name,
        verifiedAt: item.verified_at,
      })),
      nextCursor: result.next_page_params,
    };
  }

  /**
   * One eth_getBlockReceipts call per block, sequential, never batched —
   * see the doc comment on ChainAdapter.getRecentContractCreations for the
   * live batching investigation this is based on. A creation is any
   * receipt with a non-null contractAddress and status "0x1" (success); a
   * failed creation attempt still consumes gas but produces no live
   * contract and is excluded.
   */
  async getRecentContractCreations(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ContractCreation[]> {
    const creations: ContractCreation[] = [];

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1n) {
      const receipts = (await this.publicClient.request({
        method: "eth_getBlockReceipts",
        params: [numberToHex(blockNumber)],
        // eth_getBlockReceipts isn't in viem's PublicRpcSchema — same
        // unformatted-hex escape hatch as getLogs above.
      } as unknown as Parameters<PublicClient["request"]>[0])) as unknown as
        RawBlockReceiptItem[] | null;

      for (const receipt of receipts ?? []) {
        if (receipt.contractAddress === null || receipt.status !== "0x1") continue;
        creations.push({
          address: getAddress(receipt.contractAddress),
          creatorAddress: getAddress(receipt.from),
          transactionHash: receipt.transactionHash,
          blockNumber: hexToBigInt(receipt.blockNumber),
        });
      }
    }

    return creations;
  }
}
