import { Prisma } from "../generated/client/index.js";

/**
 * Two budgets, for two fundamentally different callers — conflating them
 * was the actual bug behind a ~5-minute Vercel page load
 * (docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md):
 * a 20-attempt budget sized for a background job that can afford to wait
 * was also being applied to a user's page request, which cannot.
 *
 * "background" — apps/pipeline. Sized from two real, directly-measured
 * outages against the transaction pooler (DATABASE_URL, port 6543) on
 * 2026-09-10, not a guess — the same methodology
 * packages/telegram/src/client.ts's retry budget was sized from
 * ("confirmed live... always recovering within a few minutes"). Probed
 * the pooler once/sec via the real Prisma client and logged every state
 * transition:
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
 * The pre-0020 budget (4 attempts, 3s backoff cap) worked out to roughly
 * 4 * 5s + (300+600+1200)ms ≈ 22s worst case — short of *either* observed
 * outage, which is exactly the failure decision 0020 fixed: retries
 * exhausting while the outage was still ongoing, for a background job
 * that had 3 minutes of slack to spend. Sized up to comfortably clear
 * the longer (74.17s) observed outage with margin, the same way
 * Telegram's budget was sized past its own observed worst case rather
 * than exactly to it:
 *
 *   20 attempts, 300ms base doubling to a 5000ms cap ≈
 *   20 * 5s (attempt cost) + ~79.3s (backoff sum, pre-jitter) ≈ 179s (~3min).
 *
 * "request" — apps/web. A user loading a page will not sit through
 * even a fraction of the background budget — the whole point of
 * degrading to "—"/cached data (docs/decisions/0016, 0017) is to stay
 * fast, not to eventually succeed at any cost. One retry (2 attempts
 * total), a short cap: worst case ≈ 2 * 5s (attempt cost) + ~0.2s
 * backoff ≈ 10.2s before giving up and degrading — long enough to ride
 * out a single momentary blip, nowhere close to the ~3 minutes a
 * background run can spend. Every apps/web call site passes
 * `"request"` explicitly; nothing defaults into it silently.
 *
 * Re-measure and re-size either profile if a future outage exceeds what
 * it was sized for — these are today's measured numbers, not a
 * permanent ceiling.
 */
export type DbRetryProfile = "background" | "request";

interface RetryBudget {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const RETRY_BUDGETS: Record<DbRetryProfile, RetryBudget> = {
  background: { maxAttempts: 20, baseDelayMs: 300, maxDelayMs: 5000 },
  request: { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 500 },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Migrating to `@prisma/adapter-pg` (docs/decisions/0023 — dropping the
 * native query engine entirely, since Vercel's bundler could never be
 * made to reliably ship it) changed what a connection failure actually
 * looks like. It is no longer reliably `PrismaClientInitializationError`
 * with `errorCode: "P1001"` — that assumption (docs/decisions/0020) was
 * true only for the old native-engine architecture. Re-verified live
 * against the real adapter and the real pooler rather than assumed
 * carried over, because a classifier that stops matching real failures
 * doesn't just fail loudly like the old missing-engine bug did — it
 * fails *silently*: `withDbRetry` still catches the error, still checks
 * `isConnectionError`, gets `false`, and rethrows on the very first
 * attempt with no indication anything is different, quietly turning
 * every transient pooler blip back into exactly the outage-shaped
 * failures decision 0020 was written to stop.
 *
 * Three shapes, each reproduced against a real connection (deliberately
 * broken ports/hosts, plus one genuine live pooler blip caught by
 * accident mid-investigation), not inferred from Prisma's source or docs:
 *
 * 1. `PrismaClientInitializationError` / `errorCode: "P1001"` — kept for
 *    defense; the shape decision 0020 measured against the old native
 *    engine. Not reproduced against the adapter in this investigation,
 *    but cheap to keep matching in case some path still produces it.
 * 2. `PrismaClientKnownRequestError` / `code: "P1001"` — what an
 *    *actively refused* connection (e.g. nothing listening on the port)
 *    actually surfaces as through the adapter. A different error CLASS
 *    than (1) despite the identical "Can't reach database server"
 *    message and the identical P1001 code — `errorCode` on (1) is not
 *    the same property as `code` on (2).
 * 3. A plain `Error` (literally `Error`, not any Prisma subclass — its
 *    own prototype chain is `Error -> Object`), message "Connection
 *    terminated due to connection timeout", stamped only with a
 *    `clientVersion` field. This is what a *timed-out* connection
 *    surfaces as — `PrismaPgAdapter.performIO` rethrows whatever
 *    `pg`/`pg-pool` threw almost verbatim rather than mapping it to a
 *    Prisma error class. Critically, this is the shape this project's
 *    real pooler failures actually take: decision 0020 found every
 *    observed outage failed by timing out at a uniform ~5s, never by an
 *    active refusal, and this exact shape is what one such live outage
 *    produced when it happened to hit mid-investigation, unprompted,
 *    against the real, unmodified DATABASE_URL — not just a synthetic
 *    approximation of one. This is the branch that actually matters.
 *
 * A genuine query-level failure (checked against a real unique-constraint
 * violation) stays properly wrapped as `PrismaClientKnownRequestError`
 * with a non-P1001 code regardless of any of this, so branch (2) above
 * cannot accidentally retry a real query error — only P1001 matches.
 *
 * Branch (3)'s message match is the fragile part — `pg-pool`'s own
 * wording, not a stable Prisma-assigned code. Re-verify this the same
 * way if `pg`/`pg-pool`/`@prisma/adapter-pg` ever bump a major version:
 * deliberately break a connection, read the real thrown error, don't
 * assume the message survived the upgrade.
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode === "P1001";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P1001";
  }
  return (
    error instanceof Error &&
    typeof (error as { clientVersion?: unknown }).clientVersion === "string" &&
    /connection terminated/i.test(error.message)
  );
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
 * Bounded retry, exponential backoff + jitter, for any Prisma call.
 * `profile` selects the budget — defaults to `"background"`
 * (apps/pipeline's original caller, and every existing call site there
 * that predates the two-profile split, unchanged); apps/web's Server
 * Component queries pass `"request"` explicitly. Confirmed in
 * production, repeatedly: this failure always succeeds on the very next
 * attempt or two — a transient failure, not a permanent one
 * (03-CLAUDE-BUILD-PROMPT.md's error-handling rule). Every retry is
 * logged so the flakiness stays visible rather than hidden.
 */
export async function withDbRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  profile: DbRetryProfile = "background",
): Promise<T> {
  const budget = RETRY_BUDGETS[profile];
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= budget.maxAttempts || !isConnectionError(error)) {
        throw error;
      }
      const backoffMs = Math.min(budget.baseDelayMs * 2 ** (attempt - 1), budget.maxDelayMs);
      const delayMs = Math.round(backoffMs * (0.85 + Math.random() * 0.3));
      logRetry({
        operation,
        profile,
        attempt,
        maxAttempts: budget.maxAttempts,
        delayMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
}
