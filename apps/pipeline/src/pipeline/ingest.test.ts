import type { ChainAdapter, ChainLog, ContractCreation, TokenMetadata } from "@alpharadar/chain";
import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { ingest } from "./ingest.js";

const CANDIDATE = "0xBeD6B57A5dB1aA23153A4C7740f21Fb76a7776F1" as Address;

function creationOf(address: Address): ContractCreation {
  return {
    address,
    creatorAddress: "0x02B41dcf9ed57CdFDFbd61b8836D419ea3D6E266" as Address,
    transactionHash: "0x279ea8bc44cd0ee8fc46192de0ae202c81f76c3982197add315d8690acda239d",
    blockNumber: 56_940_450n,
  };
}

// Real shape confirmed live this session (CookLauncherToken's mint).
const REAL_MINT_LOG: ChainLog = {
  address: CANDIDATE,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    ("0x" + "0".repeat(64)) as Hex,
    "0x00000000000000000000000021201cd01f5780e521e9aba088930a1292a2ef67",
  ],
  data: "0x0000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
  blockNumber: 56940452n,
  transactionHash: "0x81ccca91862af49223df904766cb29e87405b656bc565a90af69e73790e83432",
  logIndex: 74,
};

function makeChainAdapter(overrides: {
  candidates?: ContractCreation[];
  tokenMetadata?: TokenMetadata | null;
  logs?: ChainLog[];
  txValue?: bigint | null;
}): ChainAdapter {
  return {
    getRecentContractCreations: vi.fn().mockResolvedValue(overrides.candidates ?? []),
    getTokenMetadata: vi.fn().mockResolvedValue(overrides.tokenMetadata ?? null),
    getLogs: vi.fn().mockResolvedValue(overrides.logs ?? []),
    getTransaction:
      overrides.txValue === undefined
        ? vi.fn().mockResolvedValue(null)
        : vi
            .fn()
            .mockResolvedValue(overrides.txValue === null ? null : { value: overrides.txValue }),
  } as unknown as ChainAdapter;
}

function makePrisma(knownAddresses: Address[] = []) {
  return {
    contract: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        const isKnown = knownAddresses.some(
          (a) => a.toLowerCase() === where.chain_address.address.toLowerCase(),
        );
        return isKnown ? { id: "known-contract" } : null;
      }),
    },
  };
}

const PARAMS = { fromBlock: 56_940_450n, toBlock: 56_940_454n, chain: "robinhood" };

describe("ingest", () => {
  it("produces a signal for a newly-discovered ERC-721 with mint activity, reading the mint tx value", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "CookLauncherToken",
        symbol: "COOK",
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [REAL_MINT_LOG],
      txValue: 0n,
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals).toEqual([
      {
        contractAddress: CANDIDATE,
        tokenName: "CookLauncherToken",
        tokenSymbol: "COOK",
        mintTransactionHash: REAL_MINT_LOG.transactionHash,
        mintBlockNumber: REAL_MINT_LOG.blockNumber,
        mintValue: 0n,
      },
    ]);
    expect(result.candidatesScanned).toBe(1);
  });

  it("skips a contract already recorded in the database", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: null,
        symbol: null,
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [REAL_MINT_LOG],
    });
    const prisma = makePrisma([CANDIDATE]);

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals).toEqual([]);
    expect(chainAdapter.getTokenMetadata).not.toHaveBeenCalled();
  });

  it("skips a candidate that isn't classified as ERC-721", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "SomeToken",
        symbol: "STK",
        decimals: 18,
        totalSupply: 1n,
        holdersCount: 1,
        type: "ERC-20",
      },
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals).toEqual([]);
    expect(chainAdapter.getLogs).not.toHaveBeenCalled();
  });

  it("skips an ERC-721 with no mint activity in this run's block range", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "QuietCollection",
        symbol: "QUIET",
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [],
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals).toEqual([]);
  });

  it("picks the earliest mint by (blockNumber, logIndex), not array order", async () => {
    const later: ChainLog = { ...REAL_MINT_LOG, blockNumber: 56_940_453n, logIndex: 1 };
    const earlier: ChainLog = { ...REAL_MINT_LOG, blockNumber: 56_940_451n, logIndex: 0 };
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "Multi",
        symbol: "MULTI",
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [later, earlier], // out of order on purpose
      txValue: 0n,
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals).toHaveLength(1);
    expect(result.nftMintSignals[0]?.mintBlockNumber).toBe(56_940_451n);
  });

  it("classifies a nonzero mint tx value as a paid mint (mintValue > 0n)", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "PaidMint",
        symbol: "PAID",
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [REAL_MINT_LOG],
      txValue: 10_000_000_000_000_000n, // 0.01 ETH
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals[0]?.mintValue).toBe(10_000_000_000_000_000n);
  });

  it("defaults mintValue to 0n if the mint transaction can't be fetched", async () => {
    const chainAdapter = makeChainAdapter({
      candidates: [creationOf(CANDIDATE)],
      tokenMetadata: {
        address: CANDIDATE,
        name: "NoTx",
        symbol: "NOTX",
        decimals: null,
        totalSupply: null,
        holdersCount: null,
        type: "ERC-721",
      },
      logs: [REAL_MINT_LOG],
      txValue: null,
    });
    const prisma = makePrisma();

    const result = await ingest(chainAdapter, prisma as never, PARAMS);

    expect(result.nftMintSignals[0]?.mintValue).toBe(0n);
  });
});
