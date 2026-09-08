import type { ChainAdapter } from "@alpharadar/chain";
import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { verify } from "./verify.js";

const ADDRESS = "0xBeD6B57A5dB1aA23153A4C7740f21Fb76a7776F1" as Address;
const DEPLOYER = "0x02B41dcf9ed57CdFDFbd61b8836D419ea3D6E266" as Address;
const ZERO_ADDRESS = ("0x" + "0".repeat(40)) as Address;
const ZERO_SLOT = ("0x" + "0".repeat(64)) as Hex;
const NONZERO_SLOT = ("0x" + "1".repeat(64)) as Hex;
// Real mint-function selector (mint(address,uint256)), confirmed via viem's toFunctionSelector.
const MINT_BYTECODE =
  "0x6080604052348015600e575f80fd5b50600436106030575f3560e01c806340c10f1914603457" as Hex;
const CLEAN_BYTECODE =
  "0x6080604052348015600e575f80fd5b50600436106030575f3560e01c80638da5cb5b14603457" as Hex;

function makeChainAdapter(overrides: Partial<ChainAdapter> = {}): ChainAdapter {
  return {
    getChainMetadata: vi.fn().mockResolvedValue({
      chainId: 4663,
      name: "Robinhood Chain",
      nativeCurrencySymbol: "ETH",
      rpcUrl: "https://rpc",
      explorerUrl: "https://robinhoodchain.blockscout.com",
    }),
    getContractVerification: vi.fn().mockResolvedValue({
      isVerified: false,
      name: null,
      compilerVersion: null,
      language: null,
      verifiedAt: null,
    }),
    getAddressTransactions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getContractCode: vi.fn().mockResolvedValue(CLEAN_BYTECODE),
    getContractOwner: vi.fn().mockResolvedValue(null),
    getStorageAt: vi.fn().mockResolvedValue(ZERO_SLOT),
    getTokenHolders: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getTokenMetadata: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ChainAdapter;
}

function makePrisma(overrides: {
  opportunity?: Record<string, unknown>;
  contract?: Record<string, unknown> | null;
  priorDeploymentCount?: number;
}) {
  const sources: Record<string, unknown>[] = [];
  const evidence: Record<string, unknown>[] = [];
  const riskAssessments: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const contractUpdates: Record<string, unknown>[] = [];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  const opportunity = {
    id: "opp-1",
    chain: "robinhood",
    contractAddress: ADDRESS,
    type: "FREE_MINT",
    ...overrides.opportunity,
  };
  const contract =
    overrides.contract === undefined
      ? { id: "contract-1", deployerAddress: DEPLOYER, contractType: "ERC721", verified: false }
      : overrides.contract;

  return {
    opportunity: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(opportunity),
    },
    contract: {
      findUnique: vi.fn().mockResolvedValue(contract),
      update: vi.fn().mockImplementation(async ({ data }) => {
        contractUpdates.push(data);
        return { ...contract, ...data };
      }),
      count: vi.fn().mockResolvedValue(overrides.priorDeploymentCount ?? 0),
    },
    riskAssessment: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        riskAssessments.push(row);
        return row;
      }),
    },
    source: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), ...data };
        sources.push(row);
        return row;
      }),
    },
    evidence: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), ...data };
        evidence.push(row);
        return row;
      }),
    },
    opportunityEvent: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), ...data };
        events.push(row);
        return row;
      }),
    },
    _rows: { sources, evidence, riskAssessments, events, contractUpdates },
  };
}

describe("verify", () => {
  it("writes a RiskAssessment, Evidence rows, a Source, and a VERIFIED event for a fully-known contract", async () => {
    const chainAdapter = makeChainAdapter({
      getContractVerification: vi.fn().mockResolvedValue({
        isVerified: true,
        name: "Foo",
        compilerVersion: "0.8.20",
        language: "Solidity",
        verifiedAt: "2026-09-08T00:00:00Z",
      }),
      getContractOwner: vi.fn().mockResolvedValue(ZERO_ADDRESS),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.sources).toHaveLength(1);
    expect(prisma._rows.evidence.length).toBeGreaterThan(0);
    expect(
      prisma._rows.evidence.every((e) =>
        ["FACT", "INFERENCE", "UNKNOWN"].includes(e.evidenceType as string),
      ),
    ).toBe(true);
    expect(prisma._rows.riskAssessments).toHaveLength(1);
    expect(prisma._rows.events).toHaveLength(1);
    expect(prisma._rows.events[0]).toMatchObject({ eventType: "VERIFIED" });
  });

  it("updates Contract.verified when Blockscout confirms verification", async () => {
    const chainAdapter = makeChainAdapter({
      getContractVerification: vi.fn().mockResolvedValue({
        isVerified: true,
        name: null,
        compilerVersion: null,
        language: null,
        verifiedAt: null,
      }),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.contractUpdates).toContainEqual(
      expect.objectContaining({ verified: true }),
    );
  });

  it("does NOT touch Contract.verified when the verification check fails — never guess", async () => {
    const chainAdapter = makeChainAdapter({
      getContractVerification: vi.fn().mockRejectedValue(new Error("Blockscout unreachable")),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.contractUpdates).toHaveLength(0);
    expect(prisma._rows.evidence).toContainEqual(
      expect.objectContaining({
        evidenceType: "UNKNOWN",
        claim: expect.stringContaining("could not be determined"),
      }),
    );
  });

  it("records contractRisk as UNKNOWN, not a guess, when every on-chain read fails", async () => {
    const chainAdapter = makeChainAdapter({
      getContractVerification: vi.fn().mockRejectedValue(new Error("down")),
      getContractCode: vi.fn().mockRejectedValue(new Error("down")),
      getContractOwner: vi.fn().mockRejectedValue(new Error("down")),
      getStorageAt: vi.fn().mockRejectedValue(new Error("down")),
    });
    const prisma = makePrisma({
      contract: {
        id: "contract-1",
        deployerAddress: null,
        contractType: "ERC721",
        verified: false,
      },
    });

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.riskAssessments[0]).toMatchObject({ contractRisk: "UNKNOWN" });
  });

  it("flags a mint function found in bytecode", async () => {
    const chainAdapter = makeChainAdapter({
      getContractCode: vi.fn().mockResolvedValue(MINT_BYTECODE),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.riskAssessments[0]!.reasons as string[]).toContain(
      "a mint function selector is present in bytecode",
    );
  });

  it("treats ownership renounced (owner = zero address) as lower risk than an active owner", async () => {
    const renouncedAdapter = makeChainAdapter({
      getContractOwner: vi.fn().mockResolvedValue(ZERO_ADDRESS),
    });
    const activeOwnerAdapter = makeChainAdapter({
      getContractOwner: vi.fn().mockResolvedValue(DEPLOYER),
    });

    const renouncedPrisma = makePrisma({});
    const activePrisma = makePrisma({});
    await verify("opp-1", renouncedAdapter, renouncedPrisma as never);
    await verify("opp-1", activeOwnerAdapter, activePrisma as never);

    expect(renouncedPrisma._rows.evidence).toContainEqual(
      expect.objectContaining({ claim: expect.stringContaining("renounced") }),
    );
    expect(activePrisma._rows.evidence).toContainEqual(
      expect.objectContaining({ claim: expect.stringContaining("active owner") }),
    );
  });

  it("detects a proxy via a non-zero EIP-1967 implementation slot", async () => {
    const chainAdapter = makeChainAdapter({
      getStorageAt: vi.fn().mockResolvedValue(NONZERO_SLOT),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.evidence).toContainEqual(
      expect.objectContaining({ claim: expect.stringContaining("upgradeable proxy") }),
    );
  });

  it("only checks holder concentration for ERC20 contracts, not ERC721", async () => {
    const chainAdapter = makeChainAdapter();
    const prisma = makePrisma({
      contract: { id: "c1", deployerAddress: DEPLOYER, contractType: "ERC721", verified: false },
    });

    await verify("opp-1", chainAdapter, prisma as never);

    expect(chainAdapter.getTokenHolders).not.toHaveBeenCalled();
    expect(prisma._rows.riskAssessments[0]).toMatchObject({ concentrationRisk: "UNKNOWN" });
  });

  it("computes concentrationRisk for ERC20 from top-10 holders vs total supply", async () => {
    const chainAdapter = makeChainAdapter({
      getTokenHolders: vi.fn().mockResolvedValue({
        items: Array.from({ length: 10 }, (_, i) => ({
          holderAddress: `0x${i}` as Address,
          value: 100n,
          tokenId: null,
        })),
        nextCursor: null,
      }),
      getTokenMetadata: vi.fn().mockResolvedValue({
        address: ADDRESS,
        name: "T",
        symbol: "T",
        decimals: 18,
        totalSupply: 1000n,
        holdersCount: null,
        type: "ERC-20",
      }),
    });
    const prisma = makePrisma({
      contract: { id: "c1", deployerAddress: DEPLOYER, contractType: "ERC20", verified: false },
    });

    await verify("opp-1", chainAdapter, prisma as never);

    // 10 holders * 100 = 1000 / 1000 total = 100% -> CRITICAL
    expect(prisma._rows.riskAssessments[0]).toMatchObject({ concentrationRisk: "CRITICAL" });
  });

  it("only trusts deployer age when the address history fits in a single page (nextCursor null)", async () => {
    const oldTimestamp = "2020-01-01T00:00:00.000Z";
    const chainAdapter = makeChainAdapter({
      getAddressTransactions: vi.fn().mockResolvedValue({
        items: [
          {
            hash: "0xtx",
            blockNumber: 1,
            timestamp: oldTimestamp,
            from: DEPLOYER,
            to: null,
            value: 0n,
            status: "ok",
            methodName: null,
          },
        ],
        nextCursor: null,
      }),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.evidence).toContainEqual(
      expect.objectContaining({ claim: expect.stringContaining("earliest observed activity") }),
    );
  });

  it("leaves deployer age UNKNOWN when there are more pages of history than we're willing to fetch", async () => {
    const chainAdapter = makeChainAdapter({
      getAddressTransactions: vi.fn().mockResolvedValue({
        items: [
          {
            hash: "0xtx",
            blockNumber: 1,
            timestamp: "2026-01-01T00:00:00.000Z",
            from: DEPLOYER,
            to: null,
            value: 0n,
            status: "ok",
            methodName: null,
          },
        ],
        nextCursor: { block_number: 1 },
      }),
    });
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.evidence).toContainEqual(
      expect.objectContaining({
        evidenceType: "UNKNOWN",
        claim: "Deployer address age could not be determined.",
      }),
    );
  });

  it("counts prior deployments from our own DB, scoped to the same deployer and chain, excluding this contract", async () => {
    const chainAdapter = makeChainAdapter();
    const prisma = makePrisma({ priorDeploymentCount: 3 });

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma.contract.count).toHaveBeenCalledWith({
      where: { chain: "robinhood", deployerAddress: DEPLOYER, id: { not: "contract-1" } },
    });
    expect(prisma._rows.evidence).toContainEqual(
      expect.objectContaining({ claim: expect.stringContaining("3 other contract(s)") }),
    );
  });

  it("handles an opportunity with no contract address — everything UNKNOWN, no on-chain reads", async () => {
    const chainAdapter = makeChainAdapter();
    const prisma = makePrisma({
      opportunity: { id: "opp-1", chain: "robinhood", contractAddress: null, type: "AIRDROP" },
    });

    await verify("opp-1", chainAdapter, prisma as never);

    expect(chainAdapter.getContractVerification).not.toHaveBeenCalled();
    expect(prisma._rows.riskAssessments[0]).toMatchObject({
      overallRisk: "UNKNOWN",
      contractRisk: "UNKNOWN",
      concentrationRisk: "UNKNOWN",
      deployerRisk: "UNKNOWN",
    });
  });

  it("throws if resolve() somehow never created the Contract row — a genuine bug, not a degrade-to-unknown case", async () => {
    const chainAdapter = makeChainAdapter();
    const prisma = makePrisma({ contract: null });

    await expect(verify("opp-1", chainAdapter, prisma as never)).rejects.toThrow(/no Contract row/);
  });

  it("always sets liquidityRisk, socialRisk, and linkRisk to UNKNOWN (docs/decisions/0006)", async () => {
    const chainAdapter = makeChainAdapter();
    const prisma = makePrisma({});

    await verify("opp-1", chainAdapter, prisma as never);

    expect(prisma._rows.riskAssessments[0]).toMatchObject({
      liquidityRisk: "UNKNOWN",
      socialRisk: "UNKNOWN",
      linkRisk: "UNKNOWN",
    });
  });
});
