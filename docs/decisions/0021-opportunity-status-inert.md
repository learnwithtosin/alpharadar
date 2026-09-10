# 0021 — Opportunity.status never transitions; the list's live/closed filter is currently a no-op

Status: Known limitation, disclosed — needs a re-check mechanism in a later slice
Date: 2026-09-10
Related: docs/decisions/0019-web-copy-status-filter-external-links.md (where this was first found, in full technical detail — this doc is the short, easy-to-find pointer to it, not a duplicate)

## The gap, stated plainly

`Opportunity.status` (`OpportunityStatus`: `DETECTED` / `VERIFYING` /
`ACTIVE` / `UPCOMING` / `EXPIRED` / `REJECTED` / `COMPLETED`) is set
exactly once per opportunity, at creation
(`apps/pipeline/src/pipeline/opportunity-dedup.ts`'s
`findOrCreateOpportunity`, hardcoded `status: "DETECTED"`), and nothing
in the pipeline ever transitions it afterward. Every real opportunity in
the database has `status: DETECTED`, permanently, today. `endsAt` and
`startsAt` are equally never set —
`apps/pipeline/src/pipeline/score.ts`'s own comment: "Slice 1 never sets
startsAt/endsAt."

`apps/web`'s opportunities list (decision 0019) filters and sorts by
status — `ACTIONABLE_STATUSES` vs. a dimmed "closed" section — and the
filter logic itself is correct and forward-compatible. But since every
real row is `DETECTED`, which is in `ACTIONABLE_STATUSES`, the filter is
**currently a no-op against real data**: nothing has ever appeared in the
"closed" section, and nothing currently can. A closed mint has no way to
be recognized as closed.

## Why this wasn't "fixed" by inventing a rule

There is no currently-populated signal — status or time-based — that
distinguishes a genuinely-closed opportunity from an open one. Inferring
closure from age (e.g. "assume anything older than N hours is closed")
would be exactly the kind of invented rule this project's own standard
rejects: a guess presented as a fact, with no real signal behind it. See
0019 for the full reasoning on why the filter was built anyway (it's
correct and will start doing real work the moment a real transition
exists) rather than left out.

## What a fix actually needs (not built in this slice)

A re-check mechanism: something that periodically re-examines an open
opportunity against real, checkable state and transitions its status when
that state changes. Concretely, one or more of:

- **On-chain**: re-query the contract/mint state (has the mint sold out,
  has the sale window's on-chain deadline passed, has the contract's
  public sale function stopped accepting calls) and set `COMPLETED` or
  `EXPIRED` accordingly.
- **Time-based, but honestly**: only viable once `startsAt`/`endsAt` are
  actually populated at detection time (a resolve.ts change, not a web
  change) — at that point "past `endsAt`" is a real signal, not a
  guess.
- **Source-based**: if evidence gathering ever confirms a project's own
  announcement of completion (a specific `SourceType`/evidence claim),
  that's real signal too.

Any of these needs its own pipeline stage or a scheduled re-check job —
out of scope for this disclosure, which exists to make sure the gap is
findable rather than discovered by someone reading the code cold.
