// Small, self-contained retry helper — deliberately not shared with
// packages/chain/src/retry.ts. That module is generic in shape but lives
// next to chain-specific error types; duplicating ~20 lines here keeps
// packages/telegram from depending on an unrelated package for one
// function, matching this monorepo's established preference for a small
// local copy over a premature shared package (see apps/pipeline's
// db-retry.ts, extracted only within its own app, not published wider).

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  isRetryable: (error: unknown) => boolean,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= options.maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const explicitDelayMs =
        error instanceof Error && "retryAfterMs" in error
          ? (error as { retryAfterMs?: number }).retryAfterMs
          : undefined;

      const backoffMs = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      const jitter = 0.85 + Math.random() * 0.3;
      const delayMs = Math.min(explicitDelayMs ?? backoffMs * jitter, options.maxDelayMs);

      await sleepImpl(delayMs);
    }
  }
}
