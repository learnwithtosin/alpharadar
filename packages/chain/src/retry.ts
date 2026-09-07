export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries fn with exponential backoff + jitter. If the thrown error exposes
 * a `retryAfterMs` (BlockscoutHttpError, from a 429's Retry-After header),
 * that takes precedence over the computed backoff for that attempt.
 *
 * Confirmed against live Robinhood Chain: a rapid 14-request burst never
 * produced an actual 429, but did produce intermittent plain 500 "Internal
 * server error" responses (3 of 14) — so this retries 5xx as well as 429,
 * not 429 alone.
 */
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

export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;

  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}
