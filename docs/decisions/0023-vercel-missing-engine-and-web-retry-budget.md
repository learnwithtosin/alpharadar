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

## 1c. The custom-output + outputFileTracingIncludes fix *also* failed — the real fix is dropping the native engine entirely

Redeployed with 1b's fix. Region move confirmed working. The engine error persisted anyway, now with a third, more specific message:

```
Prisma Client could not locate the Query Engine for runtime "rhel-openssl-3.0.x".
This is likely caused by a bundler that has not copied "libquery_engine-rhel-openssl-3.0.x.so.node" next to the resulting bundle.
```

Search paths this time included `/vercel/path0/packages/database/generated/client` — a **build-time-only** path (`/vercel/path0` is the build container; the function runs at `/var/task`), proving `outputFileTracingIncludes` had produced a path baked in at build time rather than a file actually shipped into the deployed function.

Verified locally, rather than guessed, with a technique this sandbox has no other way to get ground truth on Vercel's real packaging (no network access to install the Vercel CLI for a real `vercel build`): built with Next's `output: "standalone"` (temporarily) and inspected `.next/standalone/` directly, then ran the actual standalone `server.js` and hit real routes.

- The `.so.node` file **was** genuinely present in the standalone-copied tree, at `packages/database/generated/client/...` — proving `outputFileTracingIncludes` correctly copies the file.
- Running the standalone server against a real DB (dummy credentials, to isolate the question) got *past* the engine error entirely, to a real "can't reach database server" failure — proving the engine loads fine from that location, at least via Next's own generic standalone packaging.
- Yet Vercel's *actual* production logs showed the engine still unfound, with search paths that never even checked that location. This means Next's own tracing behaves correctly, but Vercel's real Lambda packaging is not a drop-in equivalent of `output: standalone`, and Prisma's own runtime locator only checks a small, fixed set of candidate paths — none of which matched wherever Vercel's real packaging put the file.

Checked whether either of two further candidate fixes (moving the custom `output` inside `apps/web` itself, or further correcting `outputFileTracingIncludes`) was actually documented as correct, rather than guessing between them: found a live Prisma GitHub discussion (`prisma/orm#29339`) of someone hitting the *identical* error on Vercel + Next.js with `output` *already* placed inside their own single-app (non-monorepo) project — i.e., they'd already tried the "move output into the app" fix, with the same failure. The accepted answer there, consistent with Prisma's own pnpm-workspaces guide (which uses a driver adapter, not `binaryTargets`) and the `@prisma/nextjs-monorepo-workaround-plugin` npm listing (marked "no longer needed... the prisma-client generator now supports ESM and monorepos out of the box"): **stop shipping a native query-engine binary at all.** Use `@prisma/adapter-pg` with `engineType = "client"` — a Wasm-based query compiler, not the Rust engine — which "eliminates the entire class of Query Engine not found errors on Vercel, Cloudflare Workers, and any other serverless platform" (quoted directly from that discussion's accepted answer). Prisma 7 makes this the default.

This is a bigger change than a config tweak — surfaced to the user explicitly rather than applied unilaterally, given it touches connection pooling (decision 0020's tuning) and retry classification (this decision's own earlier fix). Approved with two explicit conditions: verify pooling parameters and retry-error shapes empirically against the real adapter and the real pooler, not by assuming they carried over.

### The migration

`packages/database/package.json`: added `@prisma/adapter-pg` **pinned to the exact installed Prisma version** (`6.19.3`, matching `prisma`/`@prisma/client`) — `pnpm add` without a version resolved `@prisma/adapter-pg@^7.10.0` by default, a major-version mismatch against the installed 6.19.3 client that would not have been obviously wrong until it broke at runtime. Also added `pg` and `@types/pg`.

`schema.prisma`'s generator block:
```prisma
generator client {
  provider   = "prisma-client-js"
  engineType = "client"
  output     = "../generated/client"
}
```
`binaryTargets` removed entirely. `engineType = "client"` is not optional here, confirmed the hard way: supplying `adapter` to `new PrismaClient({ adapter })` with the *default* engineType (`"library"`) still tried to load the native engine at query time and threw the exact same "could not locate the Query Engine" error — deliberately reproduced by moving the generated `.so.node` aside. The adapter alone only replaces the I/O transport; query compilation still needs the native/Wasm engine unless `engineType = "client"` says otherwise. With it, `prisma generate` produces `query_compiler_bg.wasm` (~2MB) instead of `libquery_engine-*.so.node` (~17.5MB) — reconfirmed by moving *every* generated engine/compiler artifact aside and running a real query, which failed with a plain `MODULE_NOT_FOUND` for `./query_compiler_bg.js` — a standard Node resolution error, not Prisma's multi-path engine search, confirming this asset is loaded like an ordinary module.

`packages/database/src/index.ts` now constructs the client with the adapter:
```ts
const databaseUrl = new URL(process.env.DATABASE_URL);
const connectionLimit = databaseUrl.searchParams.get("connection_limit");
const poolTimeoutSeconds = databaseUrl.searchParams.get("pool_timeout");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ...(connectionLimit ? { max: Number(connectionLimit) } : {}),
  ...(poolTimeoutSeconds ? { connectionTimeoutMillis: Number(poolTimeoutSeconds) * 1000 } : {}),
});
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
```

**Pooling, verified rather than assumed (per the user's explicit condition)**: `@prisma/adapter-pg` does not read `connection_limit`/`pool_timeout` off the connection string the way the native engine did — confirmed against Prisma's own connection-pool-mapping documentation, `connection_limit` maps to `pg.Pool`'s `max`, `pool_timeout` (seconds) maps to `connectionTimeoutMillis` (ms). Rather than requiring new, separately-set env vars on both deployment targets, the code above parses the *existing* `connection_limit`/`pool_timeout` values straight out of `DATABASE_URL` and maps them itself — so `apps/pipeline`'s GitHub Actions secret (`connection_limit=5`) and `apps/web`'s Vercel dashboard var (once updated to `connection_limit=1` per §4 above) keep working unchanged; neither needs to be touched for this migration. `pgbouncer=true` stays in the connection string passed to the adapter unmodified — Prisma's own current PgBouncer-with-driver-adapters documentation keeps it there verbatim in its own example, so it isn't a dead leftover.

**Retry classification, verified rather than assumed (per the user's other explicit condition)** — and this genuinely changed, in a way that would have silently broken retries if shipped unchecked: a real connection failure through the adapter does **not** reliably surface as `PrismaClientInitializationError` with `errorCode: "P1001"` the way decision 0020 measured for the native engine. Reproduced three distinct shapes live, against real broken connections (and one live pooler blip caught by accident, unprompted, mid-investigation against the real, unmodified `DATABASE_URL`):

1. `PrismaClientInitializationError` / `errorCode: "P1001"` — the original shape. Not reproduced against the adapter in this investigation; kept for defense.
2. `PrismaClientKnownRequestError` / `code: "P1001"` — what an *actively refused* connection actually throws. Same P1001 code and message as (1), but a different error **class**, with `code` not `errorCode`.
3. A plain `Error` — literally `Error`, prototype chain `Error -> Object` — message `"Connection terminated due to connection timeout"`, stamped only with a `clientVersion` field. What a *timed-out* connection throws: `PrismaPgAdapter.performIO` rethrows `pg`/`pg-pool`'s own error almost verbatim rather than mapping it to any Prisma class. **This is the shape that actually matters**: decision 0020 found every real observed pooler outage timed out at a uniform ~5s, never an active refusal, and this exact shape is what the live blip caught mid-investigation produced against the real pooler — not just a synthetic approximation.

A genuine query-level failure (checked against a real unique-constraint violation) stays correctly wrapped as `PrismaClientKnownRequestError` with a non-P1001 code regardless, so none of this risks retrying a real bug. `isConnectionError` now checks all three shapes; (3)'s message-string match is the fragile part (`pg-pool`'s own wording, not a stable Prisma code) — flagged in the code comment to re-verify live if `pg`/`pg-pool`/`@prisma/adapter-pg` ever bump a major version, the same "re-measure, don't assume" discipline as decision 0020's budget sizing.

### The Wasm compiler still needed its own fix — a different, better-behaved version of the same class of bug

Even with the native engine gone, a production `next build` still threw — this time a clean `ENOENT: ... open '<app root>/generated/client/query_compiler_bg.wasm'`, not Prisma's opaque multi-path search. Confirmed live: Prisma's bundled runtime computes this Wasm file's path relative to its own bundled location, which resolves to an **app-root-relative** `generated/client/` convention (`apps/web/generated/client/...`) regardless of what `schema.prisma`'s `output` actually points to (`packages/database/generated/client`). `outputFileTracingIncludes` can only preserve a copied file's path relative to where it actually lives — it cannot relocate it to a different destination — so the only way to make the path Prisma's runtime computes resolve to a real file is to put a copy of the compiler files at that exact app-relative location.

Added `apps/web/scripts/copy-prisma-wasm.mjs` (copies `query_compiler_bg.js`/`.wasm` from `packages/database/generated/client` into `apps/web/generated/client`, gitignored, run from new `predev`/`prebuild` npm scripts, after `prisma generate`) rather than a second Prisma generator block pointed at the same output — that would regenerate an entire second unused client (full type declarations, `index.js`, etc.) just to relocate two small runtime files. `next.config.ts`'s `outputFileTracingIncludes` now points at this real, in-project-root copy instead of the old cross-package `.so.node` path.

### Verified against the real deployed-bundle shape *and* a real running server, not just a manifest listing

Same `output: "standalone"` technique as 1b, taken one step further this time: after confirming `query_compiler_bg.wasm` is physically present in the standalone tree at the app-relative path, **ran the actual standalone `server.js` against the real database and hit real routes** — `/opportunities` and `/` both returned `HTTP 200` with genuine rendered data (opportunity rows; "SCAN 7h ago" from the real `IngestionCheckpoint`), not just a passing trace-manifest check. This is a stronger verification than 1b's (which stopped at "the file exists and the engine loads with dummy credentials") — this one exercises the complete path against production data.

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

- The Vercel dashboard change (`connection_limit=1` on `apps/web`'s `DATABASE_URL`) has not been applied — requires the user to update it directly. Unlike before the adapter migration, this is now read by our own code (`packages/database/src/index.ts`) rather than the native engine, but the value and where it's set are unchanged.
- Everything in §1c (the adapter migration, `engineType = "client"`, the wasm-compiler copy step) has not yet been deployed to Vercel — verified thoroughly locally (including a real standalone server run against production data), but not yet against Vercel's actual packaging, which 1b and 1c both found behaves differently from any local proxy in ways only a real deploy fully confirms.
- TTFB before/after, from the deployed site itself (not local): still not measured — needs the deployed URL and a fresh deploy reflecting all of this.
- `isConnectionError`'s shape (3) (plain `Error`, message match) rests on `pg-pool`'s current error wording, not a stable Prisma-assigned code — flagged in the code comment as the thing to re-verify live if `pg`/`pg-pool`/`@prisma/adapter-pg` ever bump a major version.
- Pool-exhaustion behavior (Prisma's old `P2024` timeout-waiting-for-a-connection-slot case) was not re-tested against the adapter — decision 0020 never observed this in practice against the native engine either, so it stayed out of scope here too, but it's untested with the adapter specifically.

## Verification

- `pnpm --filter @alpharadar/database test` — 2 files, 21 tests pass (12 schema.test.ts, rewritten to parse `schema.prisma`'s own source text directly since `Prisma.dmmf` no longer exists at runtime with `engineType = "client"`, confirmed live; 9 db-retry.test.ts, covering all three real connection-error shapes plus two negative cases proving the new plain-`Error` match doesn't swallow unrelated bugs).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — clean across the whole monorepo.
- `pnpm test` (full monorepo) — 352 tests pass, no regressions (`apps/pipeline`'s own connection-error test helpers construct the original `P1001`/`PrismaClientInitializationError` shape explicitly, still matched by the retained first branch of `isConnectionError`).
- **Real queries against the real Supabase pooler**, not mocks, at every stage: confirmed the adapter connects and queries successfully; confirmed three repeated/interleaved query shapes back-to-back raise no PgBouncer prepared-statement error; deliberately caused three distinct real connection failures (bad port, unroutable host, actively-refused port) and captured each one's exact thrown shape before writing `isConnectionError`; one additional live pooler outage was caught by accident, unprompted, confirming shape (3) against a real production-shaped failure, not only synthetic ones.
- Confirmed the native engine is genuinely gone as a runtime dependency (moved the generated `.so.node` aside — real query still succeeded) and confirmed what actually IS required (moved the wasm compiler files aside too — real query then failed with a plain `MODULE_NOT_FOUND`, not Prisma's engine-search error).
- **Ran a real `next build`, then the actual standalone `server.js`, against the real database**: `/opportunities` and `/` both returned `HTTP 200` with genuine rendered data (real opportunity rows; "SCAN 7h ago" from the real `IngestionCheckpoint`) — not just a trace-manifest listing or a build that exits 0, but the complete path exercised end-to-end against production data, from a bundle shaped like what Vercel would deploy.
- apps/pipeline's own runtime context (plain `tsx`, not bundled) also re-verified directly against the real pooler after the migration, since it now goes through the same adapter code.
