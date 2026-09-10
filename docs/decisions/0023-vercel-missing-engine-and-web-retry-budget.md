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

## 1b. `binaryTargets` alone wasn't enough — the deployed bundle still didn't ship the engine

Redeployed with the `binaryTargets` fix above. The region move worked (Vercel logs showed the function executing in `fra1`, 58ms). But the same error persisted, now more specific:

```
Prisma Client could not locate the Query Engine for runtime "rhel-openssl-3.0.x".
We detected that you are using Next.js, learn how to fix this: https://pris.ly/d/engine-not-found-nextjs
This is likely caused by a bundler that has not copied "libquery_engine-rhel-openssl-3.0.x.so.node" next to the resulting bundle.
```

The error's own search paths (`/var/task/apps/web/.next/server`, `/var/task/apps/web/.prisma/client`) confirmed the actual gap: the engine binary was being generated correctly, but it lived in the pnpm-hoisted virtual store (`node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client/`), and Next.js's build-time output file tracing — which decides what a deployed serverless function actually ships by walking real `import`/`require` statements from each route — never walks into that path. Read Prisma's own linked fix for this exact error (the URL in the error message itself) and cross-referenced against Prisma's current pnpm-workspace guidance and a live GitHub issue thread on this exact error (`prisma/orm#28216`) rather than guessing from either alone.

Two changes, applied together — a custom `output` alone doesn't fix the tracing gap (the binary is still loaded dynamically, not via a traceable `import`), and `outputFileTracingIncludes` alone still needs a stable path to name (the pnpm-hoisted path isn't one — it's a content hash that shifts with the lockfile):

`schema.prisma`'s generator block, adding `output`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
  output        = "../generated/client"
}
```
This moves the generated client (code + engine binaries) to `packages/database/generated/client` — already gitignored in this repo (`packages/database/generated/`), suggesting this was the originally-intended location. `packages/database/src/index.ts`, `db-retry.ts`, `db-retry.test.ts` and `schema.test.ts` — the only four places in the repo that imported `@prisma/client` directly — now import from `../generated/client/index.js` instead; every other consumer already went through `@alpharadar/database`'s re-export and needed no change.

`apps/web/next.config.ts`, adding `outputFileTracingIncludes`:
```ts
outputFileTracingIncludes: {
  "/**": ["../../packages/database/generated/client/*.so.node"],
},
```
`/**` (every route), not just the routes that query Prisma directly — `AppHeader`, rendered by the root layout, queries `IngestionCheckpoint` on every page.

### Verified against the actual deployed bundle shape, not just a passing build

Ran a real `next build` locally (`pnpm --filter @alpharadar/web build`) and inspected the `.nft.json` file-trace manifests Vercel's build consumes directly — the same mechanism that decides what ships to `/var/task` in production:

```
$ find .next/server -name "*.nft.json" | xargs grep -l "so.node"
.next/server/app/page.js.nft.json
.next/server/app/opportunities/page.js.nft.json
.next/server/app/opportunities/[id]/page.js.nft.json
... (plus pages-router boilerplate)
```

Every route touching Prisma (directly, or via `AppHeader`) lists both engine binaries:
```
../../../../../../packages/database/generated/client/libquery_engine-debian-openssl-3.0.x.so.node
../../../../../../packages/database/generated/client/libquery_engine-rhel-openssl-3.0.x.so.node
```
Resolved that relative path from the trace file's own directory and confirmed it points at the real, 17,547,808-byte binary — not a stale reference. This is what actually answers "does the deployed bundle contain the engine," as opposed to a build that merely exits 0.

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
- The custom-output/`outputFileTracingIncludes` engine fix and retry-classification fix take effect on the next deploy; the region move was already redeployed and confirmed live (`fra1`, 58ms), but this second round has not yet been.
- TTFB before/after, from the deployed site itself (not local): not yet measured — requires the deployed URL, which I don't have access to independently of the user providing it, and requires a fresh deploy to reflect these fixes.

## Verification

- `pnpm --filter @alpharadar/database test` — 2 files, 17 tests pass (12 schema.test.ts + 5 db-retry.test.ts, including the new missing-engine-is-not-retried case).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — clean across the whole monorepo, including after the custom `output`/import-path change.
- `pnpm test` (full monorepo) — 348 tests pass, no regressions (apps/pipeline's own connection-error test helpers already construct `"P1001"` explicitly, so the narrowed classifier doesn't affect them).
- Live-confirmed the `rhel-openssl-3.0.x` engine binary is actually produced by `prisma generate` at the new custom output path (checked the directory directly).
- Live-confirmed the exact shape of a missing-engine error (deliberately removed the generated binaries, caught the real thrown error) to write `isConnectionError`'s narrowing correctly rather than by inference from documentation alone.
- **Ran an actual `next build` and inspected the resulting `.nft.json` trace manifests** — the artifact Vercel's build uses to decide what ships to `/var/task` — and confirmed every Prisma-touching route's manifest lists both engine binaries at a real, resolvable path, byte-verified against the 17,547,808-byte file on disk. This directly answers "does the deployed bundle contain the engine," which a green build alone does not.
