# 0023 — Missing query engine on Vercel, retry-classification bug, region move, request-path retry budget

Status: Accepted and implemented (region move and `connection_limit=1` require a manual Vercel dashboard change — not yet applied there)
Date: 2026-09-10
Related: docs/decisions/0020-db-pooler-retry-budget-and-pool-config.md (the 20-attempt background budget this decision splits from), docs/decisions/0016/0017 (degrade-to-cached/"—" behavior this decision's request-path budget serves), docs/decisions/0022-env-loading-deployed-environments.md (prior turn, same deployment)

## Symptom

The Vercel deployment was live but painfully slow: `/opportunities` took ~5 minutes to load, and the landing page's stats degraded to "—" before eventually working. Locally, the same queries take 15-30ms. Vercel logs also showed:

```
PrismaClientInitializationError: Prisma Client could not locate the Query Engine for...
```

## 1. Root cause: a missing binary, misclassified as a transient connection failure

`packages/database/prisma/schema.prisma`'s `generator client` block had no `binaryTargets` set — only Prisma's `"native"` default, which generates an engine for whatever OS runs `prisma generate` (this project's dev machines). Vercel's Node.js serverless runtime is an Amazon-Linux-2023-based Lambda (glibc + OpenSSL 3.0, RHEL-family), and Prisma requires the `rhel-openssl-3.0.x` binary target to generate an engine that runtime can actually load. Without it, the build step's generated client had no engine the deployed function could run at all — the error is exactly what it says, a missing platform binary, not a database connection problem.

`withDbRetry`'s old classifier made this far worse than a plain crash. It retried on `error instanceof Prisma.PrismaClientInitializationError` alone — but that's Prisma's generic class for *anything* that fails during client setup, and a missing engine throws that same class. So every request retried the missing-engine failure 20 times (decision 0020's background budget), each retry attempt paying whatever the failure's own cost was, before finally throwing — this is what produced the multi-minute load, not primarily the transatlantic round trip.

**Confirmed live, not assumed**, by deliberately reproducing both failure shapes against the real Prisma client:
- A genuine connection failure throws `PrismaClientInitializationError` with `errorCode: "P1001"` ("Can't reach database server") — the only failure mode decision 0020 ever actually measured.
- A missing engine binary throws the *same class* but with `errorCode: undefined`, and a message of "Prisma Client could not locate the Query Engine for runtime...", not a connection message.

### Fixes

`schema.prisma`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```
Verified the build-time output actually contains both engines after `pnpm exec prisma generate`: `libquery_engine-debian-openssl-3.0.x.so.node` (native, for local/CI) and `libquery_engine-rhel-openssl-3.0.x.so.node` (Vercel), 17.5MB each, in the hidden `.prisma/client` directory adjacent to the generated `@prisma/client` package.

`packages/database/src/db-retry.ts`'s `isConnectionError` narrowed to the specific code:
```ts
function isConnectionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError && error.errorCode === "P1001"
  );
}
```
A same-class error with any other code (or none, as with a missing engine) now fails immediately, on the first attempt — retrying it can never succeed, since the underlying cause is a missing file, not a transient state. Added a test (`db-retry.test.ts`) that constructs the exact missing-engine error shape confirmed above and asserts it is never retried.

## 2. Region: Vercel functions were in Washington, the database is in Frankfurt

Vercel's default region for new projects is `iad1` (Washington, D.C.). Supabase for this project is `eu-central-1` (Frankfurt). Every query paid a transatlantic round trip on top of whatever the query itself cost.

Confirmed `fra1` is the correct, current Vercel region identifier for Frankfurt via Vercel's own documentation (fetched directly, not assumed) — `eu-central-1` (Frankfurt) is listed under `fra1` in Vercel's region table, and Vercel's own docs use `fra1` as a worked example elsewhere on the same page. `vercel.json`'s `regions` array is the current, documented mechanism for pinning Vercel Functions (including Next.js Server Components) to a specific region; Hobby plan supports single-region deployment.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"]
}
```

Added as `apps/web/vercel.json`. Takes effect on the next deploy.

## 3. Two retry budgets, not one — background jobs and web requests have opposite tolerances

Decision 0020's 20-attempt, ~179s-worst-case budget was sized correctly for `apps/pipeline` — a background job with a 5-minute cron window can afford to wait out a pooler blip. It was never re-examined for `apps/web`, where the exact same budget meant a real user's page request could sit for up to 3 minutes before the page's own degrade-to-cached/"—" behavior (decisions 0016, 0017) ever got a chance to kick in. That defeats the entire purpose of building a fast-degrade path.

Split into two named profiles in `packages/database/src/db-retry.ts`:

| Profile | Attempts | Backoff | Worst case | Callers |
|---|---|---|---|---|
| `background` (default) | 20 | 300ms→5000ms | ~179s | `apps/pipeline` — all 4 existing call sites unchanged, relying on the default |
| `request` | 2 | 200ms→500ms | ~10.2s | Every `apps/web` call site, passed explicitly |

`request`'s worst case is sized to ride out a single momentary blip (one retry) without making a user wait anywhere close to the background budget — long enough to matter, short enough that degrading to cached/"—" data still happens quickly. Every `apps/web` `withDbRetry` call site (`app-header.tsx`'s checkpoint, `page.tsx`'s checkpoints and contract count, `opportunities/page.tsx`'s list, `opportunities/[id]/page.tsx`'s detail and contract lookups) now passes `"request"` explicitly — nothing defaults into it silently, and `apps/pipeline` needed zero code changes.

`apps/pipeline`'s own `connection_limit` (5, via its GitHub Actions secret) was left unchanged — it isn't "serverless" in Supabase's sense (one process per scheduled run, not many concurrent invocations sharing a pool), and there's no evidence 5 causes it harm.

## 4. Supabase's actual recommended Prisma/serverless configuration — verified, not assumed

Fetched Supabase's own troubleshooting documentation directly. Findings:

- **Transaction-mode pooler, port 6543, `?pgbouncer=true`** — already this project's configuration — is exactly what Supabase recommends for Prisma on Vercel/serverless/edge. No change needed here.
- **`connection_limit`**: Supabase's own guidance, quoted directly — *"In serverless setups, begin with connection_limit=1, increasing cautiously if needed."* This project's `DATABASE_URL` was set to `connection_limit=5` (decision 0020), which was tuned for `apps/pipeline`'s single-process background job, not for Vercel's serverless functions. At 5, N concurrent Vercel invocations can reach up to `5N` connections against the pooler simultaneously — exactly the kind of pressure Supabase's serverless-specific guidance is warning against.

**Action required, cannot be done from here**: `apps/web`'s `DATABASE_URL` in the Vercel dashboard needs `connection_limit=1` (currently 5) — this is a Vercel environment variable set by the user directly in an earlier turn; I have no dashboard/API access to change it myself. `.env.example` updated to document the distinction between the two deployment targets' recommended values.

## What's still outstanding

- The Vercel dashboard changes (`connection_limit=1` on `apps/web`'s `DATABASE_URL`) have not been applied — they require the user to update them directly.
- The region move (`vercel.json`) and the binaryTargets/retry-classification fixes take effect on the next deploy; none of this has been measured against the live deployed site yet.
- TTFB before/after, from the deployed site itself (not local): not yet measured — requires the deployed URL, which I don't have access to independently of the user providing it, and requires a fresh deploy to reflect these fixes.

## Verification (local)

- `pnpm --filter @alpharadar/database test` — 2 files, 17 tests pass (12 schema.test.ts + 5 db-retry.test.ts, including the new missing-engine-is-not-retried case).
- `pnpm --filter @alpharadar/database typecheck` — clean.
- `pnpm --filter @alpharadar/pipeline test` — 9 files, 118 tests pass, no regression (its own test helpers already construct connection errors with `"P1001"` explicitly, so the narrowed classifier doesn't affect them).
- Live-confirmed the `rhel-openssl-3.0.x` engine binary is actually produced by `prisma generate` (checked the generated output directory directly, and via `DEBUG="prisma:*"` and Prisma's local binary cache).
- Live-confirmed the exact shape of a missing-engine error (deliberately removed the generated binaries, caught the real thrown error) to write `isConnectionError`'s narrowing correctly rather than by inference from documentation alone.
