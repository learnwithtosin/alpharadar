import { Prisma } from "@alpharadar/database";
import { log } from "./logger.js";

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
 * Bounded retry, exponential backoff + jitter, for any Prisma call —
 * originally built for the checkpoint's own reads/writes specifically,
 * extended here to cover ingest.ts's per-candidate reads too, since the
 * same "Can't reach database server at ...pooler.supabase.com:6543" blip
 * has now been observed hitting a plain per-candidate query, not just
 * checkpoint calls. Confirmed in production, four separate times: this
 * failure always succeeds on the very next attempt — a transient failure,
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
      log.info("db.retry", {
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
