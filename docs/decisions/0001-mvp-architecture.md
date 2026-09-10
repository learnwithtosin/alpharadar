# 0001 — MVP architecture: monorepo, four apps' worth of concerns in one pipeline process, read-only web

Status: Accepted
Date: 2026-09-10
Authoritative source: docs/spec/01-PROJECT-CONSTITUTION.md, docs/spec/02-MVP-TECHNICAL-SPECIFICATION.md, docs/spec/09-INFRASTRUCTURE-DECISION.md
Related: docs/decisions/0002-scheduled-polling.md (why the pipeline is a scheduled job, not a service)

Written now, retroactively, because the architecture itself was never
recorded as its own decision — every other doc in this directory assumes
it. First deployment (this session) is the right moment to write down why
the pieces are shaped the way they are, before that context is only
recoverable by reading code.

## The shape

A pnpm monorepo — `apps/*` for anything that runs as its own process,
`packages/*` for anything shared between them:

```
apps/pipeline   — detect, verify, score, classify, alert. Runs on a schedule, then exits.
apps/web        — read-only Next.js app. Queries Postgres directly, never writes.
packages/chain      — ChainAdapter interface + RobinhoodAdapter implementation
packages/database   — Prisma schema + generated client, the one source of truth for the data model
packages/scoring    — the deterministic scoring function, pure and unit-testable in isolation
packages/telegram   — Telegram Bot API client + the two MVP alert templates
packages/types      — shared enums, hand-kept in sync with the Prisma schema (Prisma's DSL can't import TS)
packages/config     — env var loading (dotenv) + validation (zod), one schema for every app
```

## Why one pipeline process, not several

02's original spec described seven worker apps, Redis, and BullMQ —
queues as real infrastructure. None of that exists in the MVP. The named
stages from that spec (ingest, resolve, verify, score, classify, alert)
survive as **function boundaries inside one process**
(`apps/pipeline/src/run-pipeline.ts` calls each in order), not as
separate deployable services communicating over a queue. This preserves
01's modular separation — each stage is independently testable, has its
own file, and could become a real service later if it needed to scale
independently — without the operational surface of seven things to
deploy, monitor, and keep alive. See
`docs/decisions/0002-scheduled-polling.md`'s "Related supersessions"
section for exactly which parts of 02 this replaces and why.

## Why apps/web is read-only, with no separate API layer

`apps/web`'s Server Components query `packages/database`'s shared Prisma
client directly — no REST/GraphQL API process sits between them. Two
reasons: first, the constitution's own boundary (§2) means the web app
never needs to *write* anything a user does — there's no cart, no
settings a browser session should mutate, no transaction to submit. Every
mutation in the system (`Opportunity`, `Alert`, `RiskAssessment` rows)
comes from `apps/pipeline` or from a Telegram command
(`packages/telegram`'s dispatch handlers, e.g. `/start`, `/settings`).
Second, a separate API process is exactly the kind of "infrastructure the
$0/month constraint forbids" 09 §2 names — it would need its own compute,
its own deploy target, and would duplicate the schema knowledge
`packages/database` already centralizes. Direct Server Component queries
are the honest shape for an app whose only job is to *display* what the
pipeline already decided.

## Why the data model is one shared package, not duplicated per app

Both `apps/pipeline` (writer) and `apps/web` (reader) import the exact
same generated Prisma client from `packages/database`. A schema change is
one migration, visible to both apps at compile time — a field renamed in
the schema breaks the *other* app's typecheck immediately, rather than
surfacing as a runtime mismatch between two independently-maintained
copies of "what an Opportunity looks like."

## Why packages/types exists separately from the Prisma schema

Prisma's schema DSL has no mechanism to import a TypeScript union type, so
every enum (`OpportunityType`, `RiskLevel`, `EvidenceType`, etc.) is
defined twice: once in `schema.prisma` (source of truth for the
database), once in `packages/types` (source of truth for anywhere
TypeScript code needs the value set without pulling in the whole
generated Prisma client — e.g. `apps/web`'s cached DTOs, which are
explicitly *not* full Prisma types, see decisions 0017/0018). The two
must be kept in sync by hand; `schema.prisma`'s own header comment says
so explicitly, and `packages/types/src/*.test.ts` exercises the value
sets independently so a drift shows up as a failing test, not a silent
mismatch.

## What this doesn't cover

Why the pipeline is scheduled rather than persistent — that's
`docs/decisions/0002-scheduled-polling.md`, a distinct decision (this doc
is about process/package shape; 0002 is about *when* the one process
runs). Why identity is Telegram-first with no required email/password —
`docs/decisions/0004-telegram-first-identity.md`. Why risk has permanent
`UNKNOWN` dimensions — `docs/decisions/0006-risk-and-token-page-unknowns.md`.
