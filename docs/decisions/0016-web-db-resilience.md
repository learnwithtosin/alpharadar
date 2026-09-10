# 0016 — Shared DB retry, moved to packages/database; apps/web degrades instead of crashing on connection blips

Status: Accepted and implemented
Date: 2026-09-10
Related: docs/decisions/0015-web-radar-redesign.md (the pages this hardens), apps/pipeline's `checkpoint.ts`/`ingest.ts` (where `withDbRetry` originated)

## The problem

The recurring Supabase pooler connection blip ("Can't reach database
server at `...pooler.supabase.com:6543`") has been observed repeatedly in
this project, always transient — it succeeds on retry. apps/pipeline
already had `withDbRetry` (bounded retry, exponential backoff + jitter,
connection-errors only — never a real query error like a constraint
violation) covering its own checkpoint and per-candidate reads. apps/web
had nothing: `AppHeader` and the landing page called `prisma` directly,
with no retry and no failure handling. `AppHeader` renders in the root
layout on every page, so one unretried blip there took the entire site
down with a 500 — including a first-time visitor who never touched
anything fragile.

## Fix 1 — `withDbRetry` moved to `packages/database`, not duplicated

Moved from `apps/pipeline/src/db-retry.ts` to
`packages/database/src/db-retry.ts`, exported alongside `prisma` itself,
so both apps import the same implementation instead of apps/web growing
its own copy. Behavior is unchanged — same bounded 4-attempt exponential
backoff + jitter, same `PrismaClientInitializationError`-only check (a
real query error like `P2002` is never retried). The one adjustment:
logging no longer goes through apps/pipeline's `log` helper — that would
make `packages/database` depend on `apps/*`, backwards for a shared
package — so `db-retry.ts` now writes its own minimal structured
`db.retry` JSON line directly to `console.info`, same event shape as
before, readable in whichever log apps/pipeline's GitHub Actions run or
apps/web's server console happens to be.

`apps/pipeline/src/checkpoint.ts` and `apps/pipeline/src/pipeline/
ingest.ts` now import `withDbRetry` from `@alpharadar/database` instead
of the deleted local file — no behavior change, confirmed by the
existing 118 pipeline tests passing unmodified. Test coverage for the
retry/backoff/connection-vs-query-error logic itself moved to
`packages/database/src/db-retry.test.ts` (4 tests, extracted from what
was previously exercised indirectly through `checkpoint.test.ts`).

## Fix 2 — degrade, don't crash: decorative/contextual reads vs. a page's own reason for existing

Applied `withDbRetry` to every apps/web Server Component query, but
**how a failure (after retries are exhausted) is handled differs by
what the query is for** — the same distinction the user drew explicitly:

**Decorative/contextual — degrade to absent or "—", never throw:**

- `AppHeader`'s scan-indicator checkpoint read (global — every page
  depends on this not throwing). On failure the header renders with no
  scan indicator at all — nav and the theme toggle still work. Uses a
  three-state result (not fetched yet / `undefined` = failed / `null` =
  succeeded, no checkpoint row / a real row) so a connection blip can
  never be confused with "the pipeline has genuinely never run" — those
  read as different copy ("no scans yet" is a claim about real state;
  a failure never asserts it).
- The landing page's `IngestionCheckpoint` and `Contract.count()` reads —
  two independent queries via `Promise.allSettled`, so one failing
  doesn't take the other's real number down with it. Each affected stat
  (Blocks Scanned, Contracts Inspected, Chain Height, the "Live since"
  line, the Watching badges, the "Last scan" line) shows "—" or an
  explicit "unavailable right now" / "Chain status unavailable right
  now" on failure — never a fabricated 0 or a claim like "no chains
  configured yet" that would misrepresent a blip as real empty state.
- The opportunity detail page's `Contract` lookup (chain/type/verified/
  deployer fields) — supplementary to the opportunity itself, and the
  CONTRACT panel already rendered "Unknown" for every field when no
  contract row existed, so a failed read degrades to that same existing
  fallback rather than a new failure mode.

**The page's own reason for existing — retry, then let it fail honestly:**

- `/opportunities`' own `Opportunity.findMany` — this *is* the page. On
  failure it throws through to the error boundary rather than rendering
  an empty "No opportunities detected yet." table, which would be a
  false negative (implying a real zero, not an unknown).
- The opportunity detail page's own `Opportunity.findUnique` — same
  reasoning, and explicitly distinct from `notFound()` (a real "this id
  doesn't exist," not a failure).

## Fix 3 — `app/error.tsx`: a real error page, not a stack trace

Next.js App Router convention: an `error.tsx` under `app/` is a Client
Component error boundary that catches a throw from any `page.tsx` below
it without a more specific boundary of its own — currently
`/opportunities` and `/opportunities/[id]`. Parent layouts (root
`AppHeader`/`Footer`) keep rendering around it; only the failed segment's
content is replaced. Shows "SIGNAL LOST" / "This page couldn't load,"
one sentence explaining it's usually a transient blip, the error's
`digest` (Next.js's own redacted reference id — `error.message` and
`.stack` are never rendered, and Next.js strips both from what a client
component receives in production), a "Try again" button (`reset()`), and
a link home. Confirmed live, with a real browser (Chrome via MCP) against
the dev server pointed at an intentionally-unreachable database
(`127.0.0.1:1`, chosen for a fast `ECONNREFUSED` rather than a slow DNS
or SYN timeout): `/opportunities` and `/opportunities/[id]` both render
this page (not Next's dev-only stack-trace overlay, which is a
`NODE_ENV=development`-only affordance that does not exist in
production — the actual page underneath it is what was confirmed), while
`/` renders fully with "—" stats and the header renders with no scan
indicator, both returning `200`, not `500`. The server itself stayed up
and kept serving other routes throughout.

Also confirmed against the real, currently-flaky Supabase pooler (not a
simulated failure): mid-verification, the actual connection blip fired
on `/`, retried per the logged `db.retry` lines, and recovered — the
page served real data on the same request. The failure-injection test
above is what proves what happens when it doesn't recover in time.
