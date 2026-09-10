# 0022 — .env discovery is a dev convenience, never a runtime requirement; Vercel 500 fixed

Status: Accepted and fixed
Date: 2026-09-10
Related: docs/decisions/0001-mvp-architecture.md (packages/config's role), the GitHub Actions workflow (`.github/workflows/pipeline.yml`) — the other real deployment target this same assumption touches

## What broke, in production

First real Vercel deployment 500'd at runtime. Log:

```
Error: Could not locate the monorepo root (no pnpm-workspace.yaml found above /vercel/path0/packages/config/src)
```

`packages/config/src/load-env.ts` walked up from its own file location
looking for `pnpm-workspace.yaml` to find the repo root's `.env`, and
**threw** if it reached filesystem root without finding one. That walk
ran unconditionally at module import time — so importing
`@alpharadar/config` (or `@alpharadar/database`, which imports it for
the side effect) crashed immediately on Vercel's runtime, whose
traced/bundled function filesystem contains only the files actually
referenced, not the whole repo — `pnpm-workspace.yaml` genuinely isn't
there. This is not a Vercel quirk to work around; it's the correct,
expected shape of a serverless deployment, and the code was wrong to
treat "no local dev checkout" as an error.

## The fix

`findMonorepoRoot` now returns `undefined` instead of throwing when no
marker is found — locating a dev-convenience `.env` file is simply not
possible in that shape of environment, which is not itself a problem.
Two independent guards, both skip the filesystem walk entirely and let
`process.env` stand as-is:

1. **`isDeployedEnvironment()`** — checks `VERCEL` / `GITHUB_ACTIONS` /
   `CI`, the two real deployment targets this project actually uses
   (apps/web on Vercel, apps/pipeline's cron on GitHub Actions) plus the
   generic CI signal, checked *before* ever touching the filesystem.
2. **`findMonorepoRoot`'s own `undefined` return** — the generic fallback
   for anything else (a different host, a Docker image with no `.env`
   baked in) that doesn't set one of those.

Whether a required variable is actually present is now, and was already,
a completely separate concern — `packages/config/src/env.ts`'s own
validation, which names the missing variable(s) explicitly
("`Missing required production environment variables: AUTH_SECRET,
DATABASE_URL, ...`"), never the filesystem. Fixing load-env.ts didn't
need to touch that logic at all; it just needed to stop crashing before
that logic ever got a chance to run.

## Everywhere else this assumption could have broken — checked, not assumed

Searched the entire codebase (excluding tests and build-time config
files, which run against a full checkout regardless) for anything else
that reads the filesystem or resolves paths relative to the repo layout
at runtime: `import.meta.url`, `readFileSync`/`existsSync`/`readdirSync`,
`process.cwd()`, `__dirname`/`__filename`, and dynamic `import()`/
`require()` with a computed or relative path. **`load-env.ts` was the
only source file in the entire monorepo doing any of this** — nothing
else shares the risk.

`packages/database/prisma.config.ts` also imports `@alpharadar/config`
for the same side effect, but it's only ever invoked by the `prisma` CLI
(generate/migrate/studio) — a build-time or local-dev operation, never
something that runs inside a deployed function or the pipeline's actual
execution path. It benefits from the same fix, but was never at risk of
crashing a deployment.

**apps/pipeline on GitHub Actions was never actually at risk of this
specific crash**, even before the fix — `actions/checkout@v4` clones the
full repository (including `pnpm-workspace.yaml`) before any pipeline
code runs, so `findMonorepoRoot` would have found the real root there
regardless. It's also true that `.env` is gitignored and never
committed (confirmed in decision 0020's audit), so even a successful
root-find would have loaded nothing — dotenv never overwrites a variable
already present in `process.env`, and the workflow supplies every
required variable directly via `env:` in the workflow YAML. The fix
still correctly applies there (skips the pointless walk entirely once
`GITHUB_ACTIONS`/`CI` is detected), it just wasn't fixing a live bug on
that side.

**Prisma's own binary-target auto-detection** (no explicit
`binaryTargets` in `schema.prisma`'s `generator client` block) was
checked as a plausible *adjacent* risk — a deployed runtime needing a
query-engine binary that doesn't match what was generated — but found no
evidence of being broken: `apps/web`'s build script already runs
`prisma generate` as part of `next build` (added when the Vercel build
was first prepared), and Vercel's build environment closely matches its
runtime for this purpose, which is the standard, working setup. Not
changed, since there's no confirmed problem to fix, only a category of
risk that was checked and ruled out for now.

## Verified — not just "should work now"

1. **Reproduced the original bug first**, in an isolated `/tmp` directory
   with no `pnpm-workspace.yaml` anywhere above it: the *old* code threw
   the exact reported error message under `VERCEL=1` — proving the test
   setup faithfully mirrors Vercel's runtime shape before trusting it to
   validate the fix.
2. **Same isolated setup, fixed code, three cases**: (a) `VERCEL=1` set,
   required vars only in `process.env`, no `.env` anywhere — imports
   cleanly, `getEnv().DATABASE_URL` matches what was set; (b) no
   platform env var set at all (the generic-host fallback path) — same
   clean result; (c) `VERCEL=1` set but the required vars genuinely
   absent — throws, and the message names `AUTH_SECRET`, `DATABASE_URL`,
   `DIRECT_URL`, `TELEGRAM_BOT_TOKEN` explicitly, with no mention of the
   filesystem.
3. **A real production build**, `.env` moved aside (not deleted —
   restored after), required variables exported directly into the shell
   environment (`VERCEL=1` included) exactly as Vercel would inject
   them: `pnpm --filter @alpharadar/web build` completed cleanly —
   `prisma generate` ran, `next build` compiled and typechecked, and the
   static-generation phase's real `AppHeader` checkpoint query even hit
   the known transient Supabase pooler blip and retried through it
   successfully mid-build, without the build failing.

Full suite (typecheck, lint, format, all 347 tests — three new for
`findMonorepoRoot`'s non-throwing behavior) passes.
