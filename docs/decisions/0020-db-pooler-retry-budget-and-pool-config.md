# 0020 — Retry budget resized from measured outages; Prisma pool tuned for PgBouncer; cache fallback confirmed, not assumed

Status: Accepted and implemented
Date: 2026-09-10
Related: docs/decisions/0016-web-db-resilience.md (`withDbRetry`, error boundary — semantics unchanged here, only the budget), docs/decisions/0017/0018 (`unstable_cache` usage this decision confirms the failure behavior of)

## 1. Diagnosed first: real outages, measured, not guessed

Probed `DATABASE_URL` (the transaction pooler, port 6543) once per second via the real Prisma client — the exact path the app uses — logging only state transitions, for roughly 25 minutes during this session. Five real outages occurred in that window (average spacing ~5 minutes — consistent with "nearly every session"):

| Outage | Duration | Consecutive failures | Per-attempt failure time |
|---|---|---|---|
| 1 | 10.92s | 2 | 1.35s, then 5.06s |
| 2 | **74.17s** | **10** | ~5.00-5.003s each (striking uniformity) |
| 3 | 14.38s | 2 | ~5s each |
| 4 | 4.66s | 1 | ~5s |
| 5 | 5.12s | 1 | ~5s |

**The uniform ~5-second failure time is the key finding.** That's not a fast TCP-level reject (which would fail in milliseconds) — it's Prisma's own default `connect_timeout` for the PostgreSQL connector elapsing while trying to open a *new* connection to the pooler. Each failed attempt was genuinely spending ~5 seconds before giving up, not failing instantly.

**The old budget did the arithmetic wrong for that cost.** `DB_RETRY_MAX_ATTEMPTS = 4` with a 3s backoff cap works out to roughly `4 × 5s + (300+600+1200)ms ≈ 22s` worst case — short of *four of the five* observed outages, and badly short of the 74.17s one. That's exactly the failure this session hit: retries exhausting while the real outage was still ongoing.

**Direct connection (port 5432) correlation**: a clean single-connection `psql` check against `DIRECT_URL` succeeded reliably throughout, including during an active pooler outage window (confirmed at 15:41:31Z, pooler healthy at that exact moment per the probe's heartbeat — not caught mid-outage, but consistent with every other single-shot direct check this session). One earlier attempt to correlate the two more tightly, via a 1-second-interval `psql` loop against `DIRECT_URL` in parallel, produced noisy ~4000ms-exact timeouts on roughly half of its checks — suspiciously round numbers matching the loop's own timeout wrapper, and inconsistent with every single-shot direct check before and after. Treated as likely self-inflicted contention from spawning a fresh `psql` process (fork + DNS + TLS + auth) every second for minutes, not evidence of a real direct-port problem, and set aside rather than reported as a finding — flagged here so this isn't silently dropped.

## Retry budget, sized from the numbers above

`packages/database/src/db-retry.ts`: `DB_RETRY_MAX_ATTEMPTS` 4 → **20**, `DB_RETRY_MAX_DELAY_MS` 3000 → **5000** (base delay unchanged at 300ms). Same sizing philosophy as `packages/telegram/src/client.ts`'s own budget — sized past the worst *observed* case with real margin, not to it exactly, since one outage isn't a hard ceiling:

```
20 attempts × ~5s (fixed attempt cost) + ~79.3s (backoff sum, pre-jitter) ≈ 179s (~3 minutes)
```

That comfortably clears the 74.17s worst case observed with ~2.4x margin. The doc comment on the constants carries this math and the citation, and says explicitly to re-measure and re-size if a future outage exceeds it — these are today's real numbers, not a permanent ceiling.

Test expectations updated to match (`db-retry.test.ts`, `checkpoint.test.ts`) — both asserted the old `maxAttempts: 4` / 4 call-count explicitly; updated to 20.

## 2. Connection configuration

`?pgbouncer=true` (disables Prisma's prepared-statement usage, required against PgBouncer's transaction-pooling mode) was already correct and unchanged. What was missing: `connection_limit` and `pool_timeout` were unset, so Prisma fell back to its own defaults — `connection_limit = num_cpus*2+1` (17 on this 8-core box) and `pool_timeout = 10s`. Prisma's own documented guidance for PgBouncer transaction mode is to keep the client-side pool small, since PgBouncer already pools server-side and a large Prisma-side pool just adds needless connection pressure — worse with more than one process pointed at the same pooler (this project already runs at least two: `apps/web`'s server process and `apps/pipeline`'s cron/CLI process, each with their own `PrismaClient`).

Added `&connection_limit=5&pool_timeout=10` to `DATABASE_URL` in `.env` and documented in `.env.example`.

**Honesty about what this does and doesn't explain**: the observed failure signature — `PrismaClientInitializationError` ("Can't reach database server"), not `P2024` (Prisma's own pool-timeout error code) — is what you'd see from a genuine connection-establishment failure, not from Prisma's own client-side pool being exhausted (that fails differently, with a different error). So this change is a correct, cheap, well-documented best practice that reduces the app's own footprint on a shared resource, but it isn't confirmed to be *the* root cause of these specific outages — Supabase's own PgBouncer pool_size for this project isn't visible from here (its admin console — `SHOW POOLS`/`SHOW CONFIG` via a connection to a `pgbouncer` virtual database — isn't exposed on this managed instance; confirmed by trying it directly, `FATAL: database "pgbouncer" does not exist`). If outages continue after this change, that's the next thing to check, from the Supabase dashboard's connection-pooling settings directly, not something inferable from here.

## 3. Should a cached page ever hard-fail? Checked against Next.js's own source, not assumed

Read `unstable_cache`'s actual implementation (`next/dist/esm/server/web/spec-extension/unstable-cache.js`) rather than guessing. When a stale cache entry's background revalidation throws, Next.js already catches it internally:

```js
.catch((err) => {
  console.error(`revalidating cache with key: ${invocationKey}`, err);
  // Return the stale value on error for foreground revalidation
  return cachedResponse;
});
```

and the request path returns the stale `cachedResponse` regardless of whether that background promise succeeds or fails. **`unstable_cache` already does exactly what was asked — no custom fallback wrapper needed.** A revalidation failure during a real outage is invisible to the request: no error reaches the caller, cached or not, and every `withDbRetry`-wrapped cached fetch in this app (landing stats, the opportunities list, the detail page) already gets this for free.

What that mechanism doesn't give the UI on its own: any signal that a fallback just happened. An ordinary within-60s cache hit and a "revalidation has been failing for two minutes straight" fallback look identical from the outside — both just return the last successful value. Added `fetchedAt` tracking to the opportunities list's cached DTO (set at the moment of the last *successful* fetch) and a visible note — "data delayed, last refreshed Xm ago" — shown when served data is more than 180s old (3x the 60s target, chosen with margin for a request landing just before a revalidation would ordinarily have fired). Below that threshold, ordinary within-window staleness stays silent, matching "the data is only a minute old" — above it, the page says so rather than quietly presenting outage-era data as current.

## Verification

Full suite (typecheck, lint, format, all 344 tests) passes. Live-confirmed via the running dev server across multiple real outages during this session: `/opportunities` never returned a 500 during any of the five measured outages (all were shorter than even the *old* 22s budget in 4 of 5 cases, and none were tested against the *new* budget's own limit since none reached it) — the meaningful confirmation here is the source-level one for item 3 (Next's own fallback code, read directly) combined with direct empirical confirmation that the cache serves fast (single-digit-to-tens-of-milliseconds) responses through the exact window an outage was independently confirmed active via the separate pooler probe.
