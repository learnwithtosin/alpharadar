# 0002 — Scheduled polling instead of persistent streaming (accepted latency trade-off)

Status: Accepted
Date: 2026-09-07
Supersedes: 02 §9's implied persistent ingestion, 04 Phase 3's "WebSocket/log subscription" acceptance criterion, 02 §22's "Redis health" observability requirement
Authoritative source: 09-INFRASTRUCTURE-DECISION.md §3, §11

## Decision

The MVP ingests via a scheduled poller (`apps/pipeline`, driven by GitHub
Actions cron), not a persistent WebSocket subscription. A `PollingDriver`
reads an `IngestionCheckpoint`, scans to chain head, runs the full pipeline
in one process, advances the checkpoint only after writes commit, and exits.
`ChainAdapter.subscribeToBlocks()` is declared on the interface from the
first commit but `RobinhoodAdapter` throws `NotImplemented` for it in the
MVP — this is deliberate, not an oversight, and is the seam for the future
upgrade (09 §11).

This directly supersedes 04 Phase 3's acceptance criterion, which names
"WebSocket/log subscription" as something built now. It is not.

## Why

The MVP must run at $0/month (09 §1). An always-on process is the one thing
no free tier gives away reliably. A scheduled job that wakes, catches up from
a durable checkpoint, and exits costs nothing and loses nothing — the chain
is a permanent record, so anything that happens while the poller sleeps is
read on the next run.

## The trade-off, named explicitly

This is a **knowing, accepted trade-off against 01 §21** ("optimize for low
ingestion latency"), not a gap that was missed:

| | Persistent worker | Scheduled poller (MVP) |
|---|---|---|
| Opportunities seen | 100% | 100% |
| Detection lag | seconds | 0–15 minutes |
| Cost | ~$7/mo minimum | $0 |

Coverage is unaffected — nothing is lost, only delayed. Detection lag of up
to ~15 minutes is accepted for the MVP in exchange for zero hosting cost.
GitHub Actions cron is best-effort under platform load, so some runs may land
at 12–15 minutes rather than the nominal 10.

## Upgrade path (not built now)

When detection lag proves to be the thing limiting the product — and only
then — get an Alchemy key, set `RUN_MODE=stream`, implement
`subscribeToBlocks()` and `StreamingDriver` (~100 lines), and deploy
`apps/pipeline` as a persistent worker (~$7/mo). Checkpointing is identical
in both modes, so this changes nothing about the schema, scoring, alerting,
or web app. See 09-INFRASTRUCTURE-DECISION.md §11 for the full sequence.

## Related supersessions folded into this decision

- **02 §22 "Redis health"** is removed from the observability list — there is
  no Redis in the MVP (09 §6). It is replaced by checkpoint health: surface
  `IngestionCheckpoint.lastRunStatus` and `IngestionCheckpoint.lastRunError`
  instead.
- **02 §5/§6/§19/§20** (Redis, BullMQ, seven worker apps, queues as real
  infrastructure) are replaced by a single `apps/pipeline` process. The named
  queues from 02 §20 survive as function boundaries inside that process
  (09 §6), preserving 01 §19's modular separation without the operational
  surface of seven deploy targets.

## What does not change

01 in full. The Prisma schema (plus the additive columns in 09 §7). The
adapter boundary. Deterministic-first. Telegram templates.
