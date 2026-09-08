import { Prisma, type IngestionRunStatus, type PrismaClient } from "@alpharadar/database";
import { log } from "./logger.js";

export interface CheckpointRange {
  fromBlock: bigint;
  toBlock: bigint;
}

const DB_RETRY_MAX_ATTEMPTS = 4;
const DB_RETRY_BASE_DELAY_MS = 300;
const DB_RETRY_MAX_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Connection-level only — "Can't reach database server", auth/TLS/timeout at connect time. Never a real query error (constraint violation, etc.), which is a PrismaClientKnownRequestError, a different class entirely, and is never retried here. */
function isConnectionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError;
}

/**
 * Bounded retry, exponential backoff + jitter, for the checkpoint's own
 * reads/writes specifically. Confirmed in production: "Can't reach
 * database server at ...pooler.supabase.com:6543" has recurred three times
 * against Supabase's pooled connection and succeeded on the very next
 * attempt every time — a transient failure, not a permanent one (03
 * -CLAUDE-BUILD-PROMPT.md's error-handling rule), and unattended on GitHub
 * Actions it previously meant a failed job with no useful signal. Every
 * retry is logged so the flakiness stays visible rather than hidden.
 */
async function withDbRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= DB_RETRY_MAX_ATTEMPTS || !isConnectionError(error)) {
        throw error;
      }
      const backoffMs = Math.min(
        DB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        DB_RETRY_MAX_DELAY_MS,
      );
      const delayMs = Math.round(backoffMs * (0.85 + Math.random() * 0.3));
      log.info("checkpoint.db.retry", {
        operation,
        attempt,
        maxAttempts: DB_RETRY_MAX_ATTEMPTS,
        delayMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
}

/**
 * Shared by every driver — 09 §11 point 3: "Checkpointing is identical in
 * both modes." PollingDriver calls getNextRange once per invocation;
 * StreamingDriver (not implemented yet) will call it once on startup to
 * backfill, then advance one block at a time as new blocks arrive, through
 * the same advanceCheckpoint call. Neither driver owns this logic — it
 * lives here so both get the exact same guarantee for free.
 *
 * First run (no checkpoint row for this chain) starts from the current
 * head, not genesis — required explicitly, to avoid trying to backfill the
 * entire chain history on a fresh install. Modeled as: absent checkpoint is
 * treated as if it were already at (currentHead - 1), so fromBlock
 * resolves to currentHead through the same `lastBlockNumber + 1` formula
 * every other run uses — not a special-cased empty-range branch.
 *
 * maxBlocksPerRun caps the window to the most recent N blocks: discovery
 * (getRecentContractCreations) scans every block in the range with one
 * unbatched RPC call each, and sustained batching of that call was proven
 * live not to hold up under load (see ChainAdapter.getRecentContractCreations),
 * so a run cannot afford to backfill an arbitrarily large gap. If the
 * checkpoint is further behind than maxBlocksPerRun, the range is clamped
 * to [currentHead - maxBlocksPerRun + 1, currentHead] and everything older
 * is permanently skipped, not queued — the checkpoint still advances to
 * currentHead on success, same as any other run. This is a deliberate
 * accepted-coverage-gap tradeoff, not a bug: unlike a crash (which leaves
 * the checkpoint exactly where it was so the same range is retried), a
 * healthy run that's simply behind by more than one window's worth of
 * blocks never returns to the skipped blocks.
 *
 * Returns null when there is nothing new to process (fromBlock > toBlock),
 * e.g. the poller ran again before any new block arrived.
 */
export async function getNextRange(
  prisma: Pick<PrismaClient, "ingestionCheckpoint">,
  chain: string,
  currentHead: bigint,
  maxBlocksPerRun: bigint,
): Promise<CheckpointRange | null> {
  const checkpoint = await withDbRetry("getNextRange", () =>
    prisma.ingestionCheckpoint.findUnique({ where: { chain } }),
  );
  const sinceCheckpoint = checkpoint ? checkpoint.lastBlockNumber + 1n : currentHead;
  const windowStart = currentHead - maxBlocksPerRun + 1n;
  const fromBlock = sinceCheckpoint > windowStart ? sinceCheckpoint : windowStart;

  if (fromBlock > currentHead) {
    return null;
  }

  return { fromBlock, toBlock: currentHead };
}

/**
 * Advances the checkpoint to toBlock and marks the run a success.
 *
 * Callers must only call this AFTER every write for [fromBlock, toBlock]
 * has committed. Advancing first, or advancing from inside runPipeline
 * itself, would let a crash mid-run silently skip that range on the next
 * invocation — runPipeline has no reference to the checkpoint at all, by
 * design, specifically to make that mistake impossible to make from inside
 * the pipeline. See docs/spec/09-INFRASTRUCTURE-DECISION.md §11 point 3
 * and §7.
 */
export async function advanceCheckpoint(
  prisma: Pick<PrismaClient, "ingestionCheckpoint">,
  chain: string,
  toBlock: bigint,
): Promise<void> {
  await withDbRetry("advanceCheckpoint", () =>
    prisma.ingestionCheckpoint.upsert({
      where: { chain },
      create: {
        chain,
        lastBlockNumber: toBlock,
        lastRunAt: new Date(),
        lastRunStatus: "SUCCESS",
        lastRunError: null,
      },
      update: {
        lastBlockNumber: toBlock,
        lastRunAt: new Date(),
        lastRunStatus: "SUCCESS",
        lastRunError: null,
      },
    }),
  );
}

/**
 * Records that a run failed, without moving lastBlockNumber — the range
 * stays unprocessed so the next run's getNextRange call re-derives the
 * same (or an overlapping) range instead of skipping it. A crash mid-run
 * never even reaches this (the process dies before the catch block runs),
 * which is fine: an absent or stale checkpoint row means exactly the same
 * thing either way — this range has not been confirmed processed.
 *
 * Uses updateMany rather than update: if this chain has never had a
 * successful run yet, there is no row to update, and that's not an error —
 * getNextRange's "no checkpoint" branch already means "start from current
 * head" regardless of whether a failure was ever recorded.
 */
export async function recordRunFailure(
  prisma: Pick<PrismaClient, "ingestionCheckpoint">,
  chain: string,
  error: string,
): Promise<void> {
  await withDbRetry("recordRunFailure", () =>
    prisma.ingestionCheckpoint.updateMany({
      where: { chain },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "FAILED" satisfies IngestionRunStatus,
        lastRunError: error,
      },
    }),
  );
}
