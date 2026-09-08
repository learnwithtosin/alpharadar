import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { IngestResult, NftMintSignal } from "./ingest.js";
import { resolve } from "./resolve.js";

function ingestResultOf(signals: NftMintSignal[]): IngestResult {
  return { nftMintSignals: signals, candidatesScanned: signals.length };
}

const SIGNAL: NftMintSignal = {
  contractAddress: "0xBeD6B57A5dB1aA23153A4C7740f21Fb76a7776F1" as Address,
  tokenName: "CookLauncherToken",
  tokenSymbol: "COOK",
  mintTransactionHash: "0x81ccca91862af49223df904766cb29e87405b656bc565a90af69e73790e83432" as Hex,
  mintBlockNumber: 56_940_452n,
  mintValue: 0n,
};

function makePrisma() {
  const projects: Record<string, unknown>[] = [];
  const contracts: Record<string, unknown>[] = [];
  const opportunities: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  return {
    project: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return projects.find((p) => p.slug === where.slug) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), ...data };
        projects.push(row);
        return row;
      }),
    },
    contract: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return (
          contracts.find(
            (c) =>
              c.chain === where.chain_address.chain &&
              (c.address as string).toLowerCase() === where.chain_address.address.toLowerCase(),
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), ...data };
        contracts.push(row);
        return row;
      }),
    },
    opportunity: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        return (
          opportunities.find(
            (o) =>
              o.chain === where.chain &&
              o.contractAddress === where.contractAddress &&
              o.type === where.type &&
              o.actionProfile === where.actionProfile &&
              where.status.in.includes(o.status),
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: nextId(), status: "DETECTED", ...data };
        opportunities.push(row);
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
    _rows: { projects, contracts, opportunities, events },
  };
}

describe("resolve", () => {
  it("creates Project, Contract, Opportunity and a DETECTED event for a fresh signal", async () => {
    const prisma = makePrisma();

    const result = await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });

    expect(result.createdOpportunityIds).toHaveLength(1);
    expect(result.deduplicatedCount).toBe(0);
    expect(prisma._rows.projects).toHaveLength(1);
    expect(prisma._rows.contracts).toHaveLength(1);
    expect(prisma._rows.opportunities).toHaveLength(1);
    expect(prisma._rows.events).toHaveLength(1);
    expect(prisma._rows.events[0]).toMatchObject({ eventType: "DETECTED" });
  });

  it("classifies a free mint (mintValue = 0n) as FREE_MINT", async () => {
    const prisma = makePrisma();

    await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });

    expect(prisma._rows.opportunities[0]).toMatchObject({
      type: "FREE_MINT",
      actionProfile: "MINT",
    });
  });

  it("classifies a paid mint (mintValue > 0n) as NFT_MINT", async () => {
    const prisma = makePrisma();
    const paidSignal = { ...SIGNAL, mintValue: 1_000_000_000_000_000n };

    await resolve(prisma as never, ingestResultOf([paidSignal]), { chain: "robinhood" });

    expect(prisma._rows.opportunities[0]).toMatchObject({
      type: "NFT_MINT",
      actionProfile: "MINT",
    });
  });

  it("reuses the same Project and Contract on a second signal for the same contract", async () => {
    const prisma = makePrisma();

    await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });
    await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });

    expect(prisma._rows.projects).toHaveLength(1);
    expect(prisma._rows.contracts).toHaveLength(1);
  });

  it("does not create a duplicate opportunity or event when the opportunity already exists (dedup)", async () => {
    const prisma = makePrisma();

    const first = await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });
    const second = await resolve(prisma as never, ingestResultOf([SIGNAL]), { chain: "robinhood" });

    expect(first.createdOpportunityIds).toHaveLength(1);
    expect(first.deduplicatedCount).toBe(0);
    expect(second.createdOpportunityIds).toHaveLength(0);
    expect(second.deduplicatedCount).toBe(1);
    expect(prisma._rows.opportunities).toHaveLength(1);
    expect(prisma._rows.events).toHaveLength(1);
  });

  it("returns an empty result for an empty ingest result", async () => {
    const prisma = makePrisma();

    const result = await resolve(prisma as never, ingestResultOf([]), { chain: "robinhood" });

    expect(result.createdOpportunityIds).toEqual([]);
    expect(result.deduplicatedCount).toBe(0);
    expect(prisma._rows.opportunities).toHaveLength(0);
  });
});
