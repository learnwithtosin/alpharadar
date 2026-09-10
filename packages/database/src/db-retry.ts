import { Prisma } from "@prisma/client";

/**
 * Sized from two real, directly-measured outages against the transaction
 * pooler (DATABASE_URL, port 6543) on 2026-09-10, not a guess — the same
 * methodology packages/telegram/src/client.ts's retry budget was sized
 * from ("confirmed live... always recovering within a few minutes").
 * Probed the pooler once/sec via the real Prisma client and logged every
 * state transition:
 *
 *   Outage 1: 10.92s total, 2 consecutive failures.
 *   Outage 2: 74.17s total, 10 consecutive failures.
 *
 * In both, each failed connection attempt took a strikingly uniform
 * ~5.00s to fail (5001-5063ms every time) — this is Prisma's own default
 * `connect_timeout` for the PostgreSQL connector elapsing while trying to
 * open a *new* connection to the pooler, not a fast TCP-level reject.
 * That ~5s-per-attempt cost is fixed and dominates the retry budget's
 * math far more than the backoff sleep between attempts does.
 *
 * The old budget (4 attempts, 3s backoff cap) worked out to roughly
 * 4 * 5s + (300+600+1200)ms ≈ 22s worst case — short of *either* observed
 * outage, which is exactly the failure this was sized to fix: retries
 * exhausting while the outage was still ongoing. Sized up to comfortably
 * clear the longer (74.17s) observed outage with margin, the same way
 * Telegram's budget was sized past its own observed worst case rather
 * than exactly to it — a single outage isn't a hard ceiling:
 *
 *   20 attempts, 300ms base doubling to a 5000ms cap ≈
 *   20 * 5s (attempt cost) + ~79.3s (backoff sum, pre-jitter) ≈ 179s (~3min).
 *
 * Re-measure and re-size if a future outage exceeds this — the numbers
 * above are what's actually been observed, not a permanent ceiling.
 */
const DB_RETRY_MAX_ATTEMPTS = 20;
const DB_RETRY_BASE_DELAY_MS = 300;
const DB_RETRY_MAX_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Connection-level only — "Can't reach database server", auth/TLS/timeout at connect time. Never a real query error (constraint violation, etc.), which is a PrismaClientKnownRequestError, a different class entirely, and is never retried here. */
function isConnectionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError;
}

/**
 * One JSON line per retry, so the flakiness stays visible in whatever log
 * aggregates stdout/stderr — a GitHub Actions log for apps/pipeline, the
 * server console for apps/web — without either app's own logger being a
 * dependency of this package (packages/* must not depend on apps/*).
 */
function logRetry(fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({ timestamp: new Date().toISOString(), event: "db.retry", ...fields }),
  );
}

/**
 * Bounded retry, exponential backoff + jitter, for any Prisma call. Shared
 * by apps/pipeline (where it originated — the checkpoint's own reads/
 * writes, then extended to ingest.ts's per-candidate reads) and apps/web
 * (its Server Component queries hit the same pooler and the same blip).
 * Confirmed in production, repeatedly, across both apps: this failure
 * always succeeds on the very next attempt or two — a transient failure,
 * not a permanent one (03-CLAUDE-BUILD-PROMPT.md's error-handling rule).
 * Every retry is logged so the flakiness stays visible rather than hidden.
 */
export async function withDbRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
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
      logRetry({
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
