import { CloudflareChallengeError, type ChainAdapter } from "@alpharadar/chain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunSummary } from "../run-pipeline.js";

const runPipelineMock = vi.fn();
vi.mock("../run-pipeline.js", () => ({
  runPipeline: (...args: unknown[]) => runPipelineMock(...args),
}));

// Imported after the mock so it picks up the mocked runPipeline.
const { runPollingDriver } = await import("./polling-driver.js");

const ZERO_SUMMARY: PipelineRunSummary = {
  candidatesScanned: 0,
  candidatesFailed: 0,
  nftMintSignalsFound: 0,
  tokenLaunchSignalsFound: 0,
  opportunitiesCreated: 0,
  opportunitiesDeduplicated: 0,
  opportunitiesFailed: 0,
};

// Large enough that none of these tests' checkpoint/head gaps get clamped
// by it — the windowing behavior itself is covered in checkpoint.test.ts.
const UNBOUNDED_WINDOW = 1_000_000n;

// runPipeline is mocked in this file (see below) — these two values only
// need to satisfy runPollingDriver's type signature, never actually reach
// alert(). Alert-stage behavior is covered in alert.test.ts.
const TEST_TELEGRAM_CLIENT = null;
const TEST_ALERT_CONFIG = {
  alertMinScore: 60,
  maxPerUserPerHour: 6,
  dedupeWindowHours: 24,
  webUrl: "https://alpharadar.test",
};

function makeChainAdapter(currentHead: bigint): ChainAdapter {
  return {
    getLatestBlockNumber: vi.fn().mockResolvedValue(currentHead),
  } as unknown as ChainAdapter;
}

function makeFakePrisma() {
  let checkpoint: {
    lastBlockNumber: bigint;
    lastRunStatus?: string;
    lastRunError?: string | null;
  } | null = null;

  return {
    ingestionCheckpoint: {
      findUnique: vi.fn().mockImplementation(async () => checkpoint),
      upsert: vi.fn().mockImplementation(async ({ update, create }) => {
        checkpoint = checkpoint ? { ...checkpoint, ...update } : { ...create };
        return checkpoint;
      }),
      updateMany: vi.fn().mockImplementation(async ({ data }) => {
        if (!checkpoint) return { count: 0 };
        checkpoint = { ...checkpoint, ...data };
        return { count: 1 };
      }),
    },
    getState: () => checkpoint,
  };
}

beforeEach(() => {
  runPipelineMock.mockReset();
});

describe("runPollingDriver", () => {
  it("advances the checkpoint to the current head after a successful run", async () => {
    runPipelineMock.mockResolvedValue(ZERO_SUMMARY);
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });

    expect(runPipelineMock).toHaveBeenCalledWith(100n, 100n, expect.anything());
    expect(prisma.getState()).toMatchObject({ lastBlockNumber: 100n, lastRunStatus: "SUCCESS" });
  });

  it("does nothing when there is no new range (checkpoint already at head)", async () => {
    runPipelineMock.mockResolvedValue(ZERO_SUMMARY);
    const prisma = makeFakePrisma();
    // Seed a checkpoint already at the head.
    await prisma.ingestionCheckpoint.upsert({
      where: { chain: "robinhood" },
      create: { chain: "robinhood", lastBlockNumber: 100n },
      update: { lastBlockNumber: 100n },
    });
    runPipelineMock.mockClear();
    const chainAdapter = makeChainAdapter(100n);

    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });

    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("a crash mid-run (runPipeline throws) does not advance the checkpoint — the next run re-derives the same range", async () => {
    runPipelineMock.mockRejectedValueOnce(new Error("simulated crash"));
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    await expect(
      runPollingDriver({
        prisma: prisma as never,
        chainAdapter,
        chain: "robinhood",
        maxBlocksPerRun: UNBOUNDED_WINDOW,
        telegramClient: TEST_TELEGRAM_CLIENT,
        alertConfig: TEST_ALERT_CONFIG,
      }),
    ).rejects.toThrow("simulated crash");

    // Checkpoint was never advanced — lastBlockNumber is untouched (no row
    // was ever created, since this was the very first run).
    expect(prisma.getState()).toBeNull();

    // The *next* invocation must compute the exact same range again, not
    // skip past block 100 — this is the guarantee the whole module exists
    // for (09 §11 point 3/4).
    runPipelineMock.mockResolvedValueOnce(ZERO_SUMMARY);
    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });

    expect(runPipelineMock).toHaveBeenLastCalledWith(100n, 100n, expect.anything());
  });

  it("a crash mid-run after a prior success leaves lastBlockNumber at the prior value, not the failed range", async () => {
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    // First run succeeds up to block 100.
    runPipelineMock.mockResolvedValueOnce(ZERO_SUMMARY);
    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });
    expect(prisma.getState()).toMatchObject({ lastBlockNumber: 100n });

    // Chain advances to 150; this run crashes.
    const chainAdapter2 = makeChainAdapter(150n);
    runPipelineMock.mockRejectedValueOnce(new Error("simulated crash"));
    await expect(
      runPollingDriver({
        prisma: prisma as never,
        chainAdapter: chainAdapter2,
        chain: "robinhood",
        maxBlocksPerRun: UNBOUNDED_WINDOW,
        telegramClient: TEST_TELEGRAM_CLIENT,
        alertConfig: TEST_ALERT_CONFIG,
      }),
    ).rejects.toThrow("simulated crash");

    // Still 100 — the failed [101, 150] range was never committed.
    expect(prisma.getState()).toMatchObject({ lastBlockNumber: 100n, lastRunStatus: "FAILED" });

    // Retry succeeds and re-processes the exact same range [101, 150].
    runPipelineMock.mockResolvedValueOnce(ZERO_SUMMARY);
    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter: chainAdapter2,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });
    expect(runPipelineMock).toHaveBeenLastCalledWith(101n, 150n, expect.anything());
    expect(prisma.getState()).toMatchObject({ lastBlockNumber: 150n, lastRunStatus: "SUCCESS" });
  });
});

describe("runPollingDriver logging", () => {
  function loggedEvents(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
    return spy.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);
  }

  it("logs run start, the resolved range, and completion with counts and the new checkpoint", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    runPipelineMock.mockResolvedValue({
      candidatesScanned: 3,
      candidatesFailed: 1,
      nftMintSignalsFound: 1,
      tokenLaunchSignalsFound: 1,
      opportunitiesCreated: 1,
      opportunitiesDeduplicated: 1,
      opportunitiesFailed: 0,
    } satisfies PipelineRunSummary);
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });

    const events = loggedEvents(logSpy);
    expect(events.map((e) => e.event)).toEqual([
      "pipeline.run.start",
      "pipeline.run.range",
      "pipeline.run.complete",
    ]);
    expect(events[1]).toMatchObject({ chain: "robinhood", fromBlock: "100", toBlock: "100" });
    expect(events[2]).toMatchObject({
      chain: "robinhood",
      newCheckpoint: "100",
      candidatesScanned: 3,
      candidatesFailed: 1,
      nftMintSignalsFound: 1,
      tokenLaunchSignalsFound: 1,
      opportunitiesCreated: 1,
      opportunitiesDeduplicated: 1,
      opportunitiesFailed: 0,
    });
    logSpy.mockRestore();
  });

  it("logs no_new_blocks and nothing else when the checkpoint is already at head", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const prisma = makeFakePrisma();
    await prisma.ingestionCheckpoint.upsert({
      where: { chain: "robinhood" },
      create: { chain: "robinhood", lastBlockNumber: 100n },
      update: { lastBlockNumber: 100n },
    });
    logSpy.mockClear();
    const chainAdapter = makeChainAdapter(100n);

    await runPollingDriver({
      prisma: prisma as never,
      chainAdapter,
      chain: "robinhood",
      maxBlocksPerRun: UNBOUNDED_WINDOW,
      telegramClient: TEST_TELEGRAM_CLIENT,
      alertConfig: TEST_ALERT_CONFIG,
    });

    const events = loggedEvents(logSpy);
    expect(events.map((e) => e.event)).toEqual([
      "pipeline.run.start",
      "pipeline.run.no_new_blocks",
    ]);
    logSpy.mockRestore();
  });

  it("logs a named error and still throws when the run fails", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    class BlockscoutHttpErrorLike extends Error {
      constructor() {
        super("Blockscout request failed: 500");
        this.name = "BlockscoutHttpErrorLike";
      }
    }
    runPipelineMock.mockRejectedValueOnce(new BlockscoutHttpErrorLike());
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    await expect(
      runPollingDriver({
        prisma: prisma as never,
        chainAdapter,
        chain: "robinhood",
        maxBlocksPerRun: UNBOUNDED_WINDOW,
        telegramClient: TEST_TELEGRAM_CLIENT,
        alertConfig: TEST_ALERT_CONFIG,
      }),
    ).rejects.toThrow("Blockscout request failed: 500");

    const errorEvents = loggedEvents(errorSpy);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      event: "pipeline.run.failed",
      errorName: "BlockscoutHttpErrorLike",
      errorMessage: "Blockscout request failed: 500",
      chain: "robinhood",
      fromBlock: "100",
      toBlock: "100",
    });
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs a loud, distinctly-named pipeline.rpc.challenged line (in addition to pipeline.run.failed) when a CloudflareChallengeError persists mid-run", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const challengeError = new CloudflareChallengeError(
      "RPC endpoint is challenging this request (eth_getBlockReceipts) — Cloudflare returned a managed-challenge response instead of a JSON-RPC result.",
      "eth_getBlockReceipts",
      403,
    );
    runPipelineMock.mockRejectedValueOnce(challengeError);
    const prisma = makeFakePrisma();
    const chainAdapter = makeChainAdapter(100n);

    await expect(
      runPollingDriver({
        prisma: prisma as never,
        chainAdapter,
        chain: "robinhood",
        maxBlocksPerRun: UNBOUNDED_WINDOW,
        telegramClient: TEST_TELEGRAM_CLIENT,
        alertConfig: TEST_ALERT_CONFIG,
      }),
    ).rejects.toThrow(CloudflareChallengeError);

    const errorEvents = loggedEvents(errorSpy);
    expect(errorEvents.map((e) => e.event)).toEqual([
      "pipeline.rpc.challenged",
      "pipeline.run.failed",
    ]);
    expect(errorEvents[0]).toMatchObject({
      event: "pipeline.rpc.challenged",
      errorName: "CloudflareChallengeError",
      rpcMethod: "eth_getBlockReceipts",
      httpStatus: 403,
      chain: "robinhood",
      fromBlock: "100",
      toBlock: "100",
    });
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("still records recordRunFailure and logs cleanly when the challenge happens on the very first call, before any range is computed", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const challengeError = new CloudflareChallengeError(
      "RPC endpoint is challenging this request (eth_blockNumber).",
      "eth_blockNumber",
      403,
    );
    const chainAdapter = {
      getLatestBlockNumber: vi.fn().mockRejectedValue(challengeError),
    } as unknown as ChainAdapter;
    const prisma = makeFakePrisma();

    await expect(
      runPollingDriver({
        prisma: prisma as never,
        chainAdapter,
        chain: "robinhood",
        maxBlocksPerRun: UNBOUNDED_WINDOW,
        telegramClient: TEST_TELEGRAM_CLIENT,
        alertConfig: TEST_ALERT_CONFIG,
      }),
    ).rejects.toThrow(CloudflareChallengeError);

    // No range was ever computed — must not throw trying to read
    // range.fromBlock, and recordRunFailure must still have been attempted
    // (a safe no-op here, since this is the very first run and there's no
    // checkpoint row yet to mark FAILED — see checkpoint.ts).
    expect(prisma.ingestionCheckpoint.updateMany).toHaveBeenCalledWith({
      where: { chain: "robinhood" },
      data: expect.objectContaining({ lastRunStatus: "FAILED" }),
    });
    const errorEvents = loggedEvents(errorSpy);
    expect(errorEvents.map((e) => e.event)).toEqual([
      "pipeline.rpc.challenged",
      "pipeline.run.failed",
    ]);
    // JSON.stringify drops undefined-valued keys entirely — confirms this
    // didn't crash trying to read range.fromBlock on a null range.
    expect(errorEvents[0]).not.toHaveProperty("fromBlock");
    expect(errorEvents[0]).not.toHaveProperty("toBlock");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
