import { Prisma } from "@prisma/client";

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
