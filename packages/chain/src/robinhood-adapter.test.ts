import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { BlockscoutClient } from "./blockscout-client.js";
import { NotImplementedError } from "./errors.js";
import { RobinhoodAdapter } from "./robinhood-adapter.js";

const ADDRESS = "0x492641F648a4986844848E0beFE66D14817bCE34" as Address;

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeAdapter(overrides: {
  publicClient?: Partial<PublicClient>;
  fetchImpl?: typeof fetch;
}) {
  const blockscoutClient = new BlockscoutClient({
    baseUrl: "https://robinhoodchain.blockscout.com/api",
    fetchImpl: overrides.fetchImpl ?? vi.fn(),
    sleepImpl: vi.fn().mockResolvedValue(undefined),
  });

  return new RobinhoodAdapter({
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerApiUrl: "https://robinhoodchain.blockscout.com/api",
    publicClient: (overrides.publicClient ?? {}) as PublicClient,
    blockscoutClient,
  });
}

describe("RobinhoodAdapter — RPC-backed methods", () => {
  it("getChainMetadata reports chain id 4663", async () => {
    const adapter = makeAdapter({});
    await expect(adapter.getChainMetadata()).resolves.toEqual({
      chainId: 4663,
      name: "Robinhood Chain",
      nativeCurrencySymbol: "ETH",
      rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    });
  });

  it("getBlock maps a viem block to ChainBlock", async () => {
    const getBlock = vi.fn().mockResolvedValue({
      number: 100n,
      hash: "0xblock" as Hex,
      parentHash: "0xparent" as Hex,
      timestamp: 1_700_000_000n,
      transactions: ["0xtx1", "0xtx2"] as Hex[],
    });
    const adapter = makeAdapter({ publicClient: { getBlock } });

    await expect(adapter.getBlock(100n)).resolves.toEqual({
      number: 100n,
      hash: "0xblock",
      parentHash: "0xparent",
      timestamp: 1_700_000_000n,
      transactionHashes: ["0xtx1", "0xtx2"],
    });
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });

  it("getTransaction returns null when viem throws TransactionNotFoundError", async () => {
    const getTransaction = vi
      .fn()
      .mockRejectedValue(new TransactionNotFoundError({ hash: "0xabc" as Hex }));
    const adapter = makeAdapter({ publicClient: { getTransaction } });

    await expect(adapter.getTransaction("0xabc" as Hex)).resolves.toBeNull();
  });

  it("getReceipt returns null when viem throws TransactionReceiptNotFoundError", async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValue(new TransactionReceiptNotFoundError({ hash: "0xabc" as Hex }));
    const adapter = makeAdapter({ publicClient: { getTransactionReceipt } });

    await expect(adapter.getReceipt("0xabc" as Hex)).resolves.toBeNull();
  });

  it("getReceipt maps status and logs", async () => {
    const log: Log = {
      address: "0xtoken" as Address,
      topics: ["0xtopic0"] as unknown as Log["topics"],
      data: "0xdata" as Hex,
      blockNumber: 100n,
      transactionHash: "0xtx" as Hex,
      logIndex: 3,
      blockHash: "0xblockhash" as Hex,
      transactionIndex: 1,
      removed: false,
    };
    const getTransactionReceipt = vi.fn().mockResolvedValue({
      transactionHash: "0xtx" as Hex,
      blockNumber: 100n,
      status: "success",
      contractAddress: null,
      gasUsed: 21000n,
      logs: [log],
    });
    const adapter = makeAdapter({ publicClient: { getTransactionReceipt } });

    await expect(adapter.getReceipt("0xtx" as Hex)).resolves.toEqual({
      transactionHash: "0xtx",
      blockNumber: 100n,
      status: "success",
      contractAddress: null,
      gasUsed: 21000n,
      logs: [
        {
          address: "0xtoken",
          topics: ["0xtopic0"],
          data: "0xdata",
          blockNumber: 100n,
          transactionHash: "0xtx",
          logIndex: 3,
        },
      ],
    });
  });

  it("getContractCode normalizes undefined (EOA) to 0x", async () => {
    const getCode = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ publicClient: { getCode } });

    await expect(adapter.getContractCode(ADDRESS)).resolves.toBe("0x");
  });

  it("getLogs chunks the range and calls request() once per chunk, sequentially, hex-encoding bounds", async () => {
    const calls: Array<{ fromBlock: string; toBlock: string }> = [];
    const request = vi
      .fn()
      .mockImplementation(async (args: { params: [{ fromBlock: string; toBlock: string }] }) => {
        calls.push({ fromBlock: args.params[0].fromBlock, toBlock: args.params[0].toBlock });
        return [];
      });
    const adapter = makeAdapter({ publicClient: { request } });

    await adapter.getLogs({ fromBlock: 0n, toBlock: 2500n, address: ADDRESS });

    expect(calls).toEqual([
      { fromBlock: "0x0", toBlock: "0x3e7" },
      { fromBlock: "0x3e8", toBlock: "0x7cf" },
      { fromBlock: "0x7d0", toBlock: "0x9c4" },
    ]);
  });

  it("getLogs forwards address and topics to the raw eth_getLogs call", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const adapter = makeAdapter({ publicClient: { request } });
    const topics = [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex,
      ("0x" + "0".repeat(64)) as Hex,
      null,
    ];

    await adapter.getLogs({ fromBlock: 0n, toBlock: 10n, address: ADDRESS, topics });

    expect(request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [{ address: ADDRESS, topics, fromBlock: "0x0", toBlock: "0xa" }],
    });
  });

  it("getLogs hand-parses raw hex fields and checksums the address — confirmed live shape", async () => {
    const rawLog = {
      address: "0xbed6b57a5db1aa23153a4c7740f21fb76a7776f1",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        ("0x" + "0".repeat(64)) as Hex,
        "0x00000000000000000000000021201cd01f5780e521e9aba088930a1292a2ef67",
      ],
      data: "0x0000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
      blockNumber: "0x364d7a4",
      transactionHash: "0x81ccca91862af49223df904766cb29e87405b656bc565a90af69e73790e83432",
      logIndex: "0x4a",
      removed: false,
    };
    const request = vi.fn().mockResolvedValue([rawLog]);
    const adapter = makeAdapter({ publicClient: { request } });

    const [log] = await adapter.getLogs({ fromBlock: 0n, toBlock: 10n, address: ADDRESS });

    expect(log).toEqual({
      address: "0xBeD6B57A5dB1aA23153A4C7740f21Fb76a7776F1",
      topics: rawLog.topics,
      data: rawLog.data,
      blockNumber: 56940452n,
      transactionHash: rawLog.transactionHash,
      logIndex: 74,
    });
  });

  it("getLogs drops removed (reorg'd) logs", async () => {
    const request = vi.fn().mockResolvedValue([
      {
        address: ADDRESS,
        topics: [],
        data: "0x",
        blockNumber: "0x1",
        transactionHash: "0xtx",
        logIndex: "0x0",
        removed: true,
      },
    ]);
    const adapter = makeAdapter({ publicClient: { request } });

    const logs = await adapter.getLogs({ fromBlock: 0n, toBlock: 10n, address: ADDRESS });

    expect(logs).toEqual([]);
  });

  it("subscribeToBlocks throws NotImplementedError", async () => {
    const adapter = makeAdapter({});
    await expect(adapter.subscribeToBlocks(() => {})).rejects.toThrow(NotImplementedError);
  });
});

describe("RobinhoodAdapter — Blockscout-backed methods", () => {
  it("getTokenMetadata converts string decimals/supply/holders to numeric types", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        address_hash: ADDRESS,
        name: "Chainlink",
        symbol: "LINK",
        decimals: "18",
        total_supply: "145051493188200885459",
        holders_count: "41",
        type: "ERC-20",
      }),
    );
    const adapter = makeAdapter({ fetchImpl });

    await expect(adapter.getTokenMetadata(ADDRESS)).resolves.toEqual({
      address: ADDRESS,
      name: "Chainlink",
      symbol: "LINK",
      decimals: 18,
      totalSupply: 145051493188200885459n,
      holdersCount: 41,
      type: "ERC-20",
    });
  });

  it("getTokenHolders maps items and passes next_page_params through as nextCursor", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [{ address: { hash: "0xholder" }, token_id: null, value: "1000" }],
        next_page_params: { block_number: 100, index: 2, items_count: 50 },
      }),
    );
    const adapter = makeAdapter({ fetchImpl });

    await expect(adapter.getTokenHolders(ADDRESS)).resolves.toEqual({
      items: [{ holderAddress: "0xholder", value: 1000n, tokenId: null }],
      nextCursor: { block_number: 100, index: 2, items_count: 50 },
    });
  });

  it("getContractVerification returns isVerified: false on a 404, not an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { message: "Not found" }));
    const adapter = makeAdapter({ fetchImpl });

    await expect(adapter.getContractVerification(ADDRESS)).resolves.toEqual({
      isVerified: false,
      name: null,
      compilerVersion: null,
      language: null,
      verifiedAt: null,
    });
  });

  it("getContractVerification maps a verified contract's fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        is_verified: true,
        name: "CookLauncherToken",
        compiler_version: "v0.8.26+commit.8a97fa7a",
        language: "solidity",
        verified_at: "2026-09-07T15:29:37.842085Z",
      }),
    );
    const adapter = makeAdapter({ fetchImpl });

    await expect(adapter.getContractVerification(ADDRESS)).resolves.toEqual({
      isVerified: true,
      name: "CookLauncherToken",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      language: "solidity",
      verifiedAt: "2026-09-07T15:29:37.842085Z",
    });
  });

  it("getAddressTransactions maps status and falls through to 'unknown' for anything else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            hash: "0xtx",
            block_number: 100,
            timestamp: "2026-09-07T15:29:42.000000Z",
            from: { hash: "0xfrom" },
            to: { hash: "0xto" },
            value: "0",
            status: "ok",
            method: "initialize",
          },
        ],
        next_page_params: null,
      }),
    );
    const adapter = makeAdapter({ fetchImpl });

    await expect(adapter.getAddressTransactions(ADDRESS)).resolves.toEqual({
      items: [
        {
          hash: "0xtx",
          blockNumber: 100,
          timestamp: "2026-09-07T15:29:42.000000Z",
          from: "0xfrom",
          to: "0xto",
          value: 0n,
          status: "ok",
          methodName: "initialize",
        },
      ],
      nextCursor: null,
    });
  });
});
