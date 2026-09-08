import { describe, expect, it, vi } from "vitest";
import { advanceCheckpoint, getNextRange, recordRunFailure } from "./checkpoint.js";

// A window far larger than any gap used in these tests, so tests not
// specifically about the windowing/skip behavior read as if it weren't
// there — see the dedicated "block window" describe block below for that.
const UNBOUNDED = 1_000_000n;

function makePrisma(overrides: {
  findUnique?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
}) {
  return {
    ingestionCheckpoint: {
      findUnique: overrides.findUnique ?? vi.fn(),
      upsert: overrides.upsert ?? vi.fn(),
      updateMany: overrides.updateMany ?? vi.fn(),
    },
  } as unknown as Parameters<typeof getNextRange>[0];
}

describe("getNextRange", () => {
  it("starts from the current head, not genesis, when no checkpoint exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, UNBOUNDED);

    expect(range).toEqual({ fromBlock: 56_950_000n, toBlock: 56_950_000n });
  });

  it("resumes from lastBlockNumber + 1 when a checkpoint exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_940_000n });
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, UNBOUNDED);

    expect(range).toEqual({ fromBlock: 56_940_001n, toBlock: 56_950_000n });
  });

  it("returns null when there is nothing new since the last run", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_950_000n });
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, UNBOUNDED);

    expect(range).toBeNull();
  });

  it("returns null when the checkpoint is already ahead of the reported head", async () => {
    // Defensive case — shouldn't happen against a real chain, but must not
    // produce a negative-length range if it ever does.
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_950_100n });
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, UNBOUNDED);

    expect(range).toBeNull();
  });

  it("scopes the lookup to the given chain", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });

    await getNextRange(prisma, "robinhood", 1n, UNBOUNDED);

    expect(findUnique).toHaveBeenCalledWith({ where: { chain: "robinhood" } });
  });
});

describe("advanceCheckpoint", () => {
  it("upserts lastBlockNumber, lastRunStatus SUCCESS, and clears any prior error", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ upsert });

    await advanceCheckpoint(prisma, "robinhood", 56_950_000n);

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({ chain: "robinhood" });
    expect(call.create).toMatchObject({
      chain: "robinhood",
      lastBlockNumber: 56_950_000n,
      lastRunStatus: "SUCCESS",
      lastRunError: null,
    });
    expect(call.update).toMatchObject({
      lastBlockNumber: 56_950_000n,
      lastRunStatus: "SUCCESS",
      lastRunError: null,
    });
  });
});

describe("recordRunFailure", () => {
  it("records status/error via updateMany without touching lastBlockNumber", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ updateMany });

    await recordRunFailure(prisma, "robinhood", "RPC timeout");

    expect(updateMany).toHaveBeenCalledWith({
      where: { chain: "robinhood" },
      data: expect.objectContaining({
        lastRunStatus: "FAILED",
        lastRunError: "RPC timeout",
      }),
    });
    // Deliberately not present in the failure-path update at all.
    expect(updateMany.mock.calls[0]?.[0].data.lastBlockNumber).toBeUndefined();
  });

  it("is a safe no-op when no checkpoint row exists yet (first run failed before any success)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({ updateMany });

    await expect(recordRunFailure(prisma, "robinhood", "boom")).resolves.toBeUndefined();
  });
});

describe("crash-mid-run never skips a range — the guarantee this module exists for", () => {
  it("re-derives the exact same range on the next call when a run fails before advancing", async () => {
    // Simulates: first run has no checkpoint, computes [head, head],
    // fails before calling advanceCheckpoint (a "crash mid-run"). The
    // driver would call recordRunFailure, but crucially NOT
    // advanceCheckpoint. The next invocation must compute the identical
    // range, not skip past it.
    const storedCheckpoint: { lastBlockNumber: bigint } | null = null;

    const findUnique = vi.fn().mockImplementation(async () => storedCheckpoint);
    const updateMany = vi.fn().mockImplementation(async () => {
      // recordRunFailure never sets lastBlockNumber — confirm the fake
      // store reflects that by simply not changing it.
      return { count: storedCheckpoint ? 1 : 0 };
    });
    const prisma = makePrisma({ findUnique, updateMany });

    const currentHead = 100n;

    const firstAttempt = await getNextRange(prisma, "robinhood", currentHead, UNBOUNDED);
    expect(firstAttempt).toEqual({ fromBlock: 100n, toBlock: 100n });

    // "Crash" — record failure, do not advance.
    await recordRunFailure(prisma, "robinhood", "simulated crash");
    expect(storedCheckpoint).toBeNull(); // still nothing committed

    const secondAttempt = await getNextRange(prisma, "robinhood", currentHead, UNBOUNDED);
    expect(secondAttempt).toEqual(firstAttempt);
  });
});

describe("getNextRange — accepted block window (gaps are skipped, not backfilled)", () => {
  it("clamps fromBlock to the window when the checkpoint is further behind than maxBlocksPerRun", async () => {
    // Checkpoint is 10,000 blocks behind; the window only allows 150.
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_940_000n });
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, 150n);

    // Not 56_940_001n (that would be a 10,000-block backfill) — the
    // 9,850 skipped blocks are gone for good.
    expect(range).toEqual({ fromBlock: 56_949_851n, toBlock: 56_950_000n });
  });

  it("uses the checkpoint, not the window, when the checkpoint is within the window", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_949_990n });
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, 150n);

    expect(range).toEqual({ fromBlock: 56_949_991n, toBlock: 56_950_000n });
  });

  it("still starts from the current head, not a full window back, on the very first run", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({ findUnique });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, 150n);

    expect(range).toEqual({ fromBlock: 56_950_000n, toBlock: 56_950_000n });
  });

  it("advances the checkpoint straight to currentHead even though a gap was skipped", async () => {
    const findUnique = vi.fn().mockResolvedValue({ lastBlockNumber: 56_940_000n });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ findUnique, upsert });

    const range = await getNextRange(prisma, "robinhood", 56_950_000n, 150n);
    await advanceCheckpoint(prisma, "robinhood", range!.toBlock);

    expect(upsert.mock.calls[0]?.[0].update).toMatchObject({ lastBlockNumber: 56_950_000n });
  });
});
