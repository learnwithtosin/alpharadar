# AlphaRadar — Infrastructure Decision (Zero-Cost MVP)

Version: 1.0
Status: Authoritative — supersedes conflicting parts of files 02 and 05
Date: 7 September 2026

---

## 1. Constraint

The MVP must cost nothing to run. No credit card, no trial that expires.

## 2. What that forbids

Exactly one thing: **an always-on process.** A worker that never sleeps is the
thing every free tier is built to charge for. There is no provider where this is
free and reliable, and shopping for one is wasted time.

Everything else in the spec pack survives unchanged.

## 3. The replacement: scheduled polling

Instead of a persistent WebSocket subscription, a **scheduled job** wakes on a
timer, reads every block since its last checkpoint, runs the full pipeline, and
exits.

**Coverage is unaffected.** The chain is a permanent record. Nothing that
happens while the poller sleeps is lost — it is read on the next run. What
changes is latency, not completeness.

| | Persistent worker | Scheduled poller |
|---|---|---|
| Opportunities seen | 100% | 100% |
| Detection lag | seconds | 0–15 minutes |
| Cost | ~$7/mo minimum | $0 |

**This must be built as a swappable driver from day one.** The pipeline does not
know how it was woken up. Two drivers call the same `runPipeline(fromBlock,
toBlock)`:

- `PollingDriver` — reads checkpoint, scans to head, runs, advances, exits.
- `StreamingDriver` — on start, backfills checkpoint→head; then subscribes to
  new blocks and runs per block.

Selected by `RUN_MODE=poll|stream`. Slice 1 implements `PollingDriver` only, but
the seam exists from the first commit. See §11 for the full upgrade path.

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Database | **Supabase** (free) | 500 MB, unlimited API requests, no compute-hour meter, commercial use permitted, no card. Pauses only after 7 days idle — we run daily, so never. |
| Scheduler | **GitHub Actions cron** (free) | Free without minute limits on a public repo. Runs the poller on a timer. |
| Web app | **Vercel Hobby** (free) | Next.js. See caveat in §8. |
| Chain access | **Robinhood Chain public RPC** | Rate limited, but a 15-minute poll is nowhere near the limit. No paid provider needed. |
| Indexer | **Blockscout REST API** | Free. Primary discovery source — see §5. |
| Delivery | **Telegram Bot API** | Free, no quota, no card. |
| AI | **Off in Slice 1** | The only genuine variable cost. Interface built, flag off. |

### Rejected

- **Neon** — free plan is 0.5 GB and 100 compute-hours per project per month,
  with compute suspending after 5 minutes idle. Our workload queries constantly
  so compute never sleeps; 100 CU-hours runs out around day 16 and the project
  suspends until the next billing period. Neon's meter suits spiky, idle-heavy
  apps. Ours is the opposite.
- **Render** — free web services spin down after 15 minutes and take ~1 minute
  to wake; a workspace gets 750 free instance hours a month, roughly one
  always-on service; free Postgres **expires 30 days after creation**.
  Background workers are a paid service type from $7/mo.
- **Railway** — free trial already used.
- **Redis / BullMQ** — see §6.

## 5. Discovery strategy

Contract deployments emit no event log, so `eth_getLogs` cannot see them.
Scanning every block for `to == null` transactions would mean fetching thousands
of blocks per run against a rate-limited endpoint.

**Primary discovery is the Blockscout API**, which already indexes new
contracts and tokens — one HTTP call replaces thousands of RPC calls.

**Secondary is RPC**, used narrowly: `eth_getLogs` filtered to `Transfer` events
from the zero address (mints) on contracts already being tracked, chunked into
block ranges to respect any per-call range cap.

The exact Blockscout endpoint shapes must be **probed during implementation,
not assumed** — API versions differ between deployments. Wrap whatever is found
behind the `ChainAdapter` interface so the rest of the system never knows.

## 6. Redis and BullMQ are removed from the MVP

Queues exist to pass work between processes that are always running. When the
whole pipeline executes inside a single scheduled invocation, there is nothing
to hand off.

**The queue names from file 02 §20 survive as function boundaries.** Each stage
stays a separate module with the same responsibility:

```
runPipeline()
  → ingest()          // was: ingestion queue
  → resolve()         // was: opportunity-resolution queue
  → verify()          // was: verification queue
  → score()           // was: scoring queue
  → analyze()         // was: ai-analysis queue   [flag-gated, off in Slice 1]
  → alert()           // was: alerts queue
```

Reinstating BullMQ later means wrapping each function in a job handler. The
module boundaries required by file 01 §19 are preserved exactly.

## 7. Schema additions

Two additions to the spec's schema in file 02 §7. Both are required by polling
and neither exists in the original.

### IngestionCheckpoint (new table)

```
id, chain, lastBlockNumber, lastRunAt, lastRunStatus, lastRunError, createdAt, updatedAt
```

This is how the poller knows where it stopped. Without it, every run either
re-scans from genesis or loses everything between runs. **Unique on `chain`.**

Advancing the checkpoint must happen **only after** the run's writes commit —
otherwise a mid-run crash silently skips a block range forever.

### Additions to existing tables

Per the engineering review (file 08): `Opportunity.scoreInputs` (JSONB),
`Opportunity.scoringVersion`, `Alert.suppressedReason`, `Alert.targetChatId`,
nullable `Alert.userId`, nullable `User.email` and `User.passwordHash`.

## 8. Known ceilings

Written down now so they are not surprises later.

- **Vercel Hobby is licensed for personal, non-commercial use.** Correct while
  you are the only user. Must be revisited the day anyone is charged.
- **Supabase free is 500 MB.** `WalletActivity` and `OpportunityEvent` grow
  fastest. Add a retention job before they matter.
- **GitHub Actions cron is best-effort** and can be delayed under platform
  load. Schedule for every 10 minutes and expect some runs at 12–15.
- **Supabase + Prisma needs two connection strings** — the pooled connection
  (pgBouncer) for the application and a direct connection for migrations.
  Getting this wrong produces confusing migration failures.
- **The upgrade path is one paid service.** When alert quality justifies it,
  move the poller to a persistent worker (~$7/mo) and detection lag drops from
  minutes to seconds. Nothing else changes.

## 9. Environment contract (supersedes file 05)

```
NODE_ENV=development
WEB_URL=http://localhost:3000
AUTH_SECRET=

# Supabase Postgres
DATABASE_URL=            # pooled connection, port 6543, ?pgbouncer=true
DIRECT_URL=              # direct connection, port 5432, for migrations

# Pipeline driver — see §11
RUN_MODE=poll                   # poll | stream

# Robinhood Chain
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
ROBINHOOD_WS_URL=               # unused while RUN_MODE=poll
ROBINHOOD_CHAIN_ID=4663
ROBINHOOD_EXPLORER_API_URL=https://robinhoodchain.blockscout.com/api
ROBINHOOD_EXPLORER_URL=https://robinhoodchain.blockscout.com

# Telegram
TELEGRAM_BOT_TOKEN=

# Pipeline controls
POLL_BLOCK_CHUNK_SIZE=1000
ALERT_MIN_SCORE=60
ALERT_MAX_PER_USER_PER_HOUR=6
AI_ENABLED=false
AI_PROVIDER=claude
AI_API_KEY=
AI_MIN_SCORE_TO_ANALYZE=70

LOG_LEVEL=info
```

Removed from file 05: `REDIS_URL`, `API_URL`. `ROBINHOOD_WS_URL` is retained but
unused until `RUN_MODE=stream`.

---

## 11. The upgrade seam

The MVP is deliberately slow. When detection lag proves to be the thing holding
the product back — and only then — this is the change.

### What gets built now to make it cheap later

1. **The app is named `apps/pipeline`, not `apps/poller`.** Naming it after the
   scheduler bakes a temporary decision into every import path.
2. **`ChainAdapter` declares `subscribeToBlocks()` from the first commit**, even
   though `RobinhoodAdapter` throws `NotImplemented` for it in Slice 1. Adding a
   method to an interface later touches every consumer; declaring it now costs
   one line.
3. **Checkpointing is identical in both modes.** Streaming still advances the
   checkpoint, and still backfills from it on startup. This means a crash, a
   deploy, or a dropped socket loses nothing — the same guarantee polling has,
   through the same code.
4. **Every pipeline stage is already idempotent**, enforced by the dedupe
   constraint. Streaming does not need weaker or stronger guarantees, just
   faster ones.

### The upgrade itself

| Step | Change |
|---|---|
| 1 | Get an Alchemy key for Robinhood Chain. The public RPC is rate limited and documented for prototyping, not persistent subscriptions. Free tier is likely sufficient at MVP volume — verify before paying. |
| 2 | Set `ROBINHOOD_WS_URL` and `RUN_MODE=stream`. |
| 3 | Implement `subscribeToBlocks()` in `RobinhoodAdapter`, and `StreamingDriver`. This is the only new code — perhaps 100 lines. |
| 4 | Deploy `apps/pipeline` as a Render background worker, ~$7/mo. |
| 5 | Disable the GitHub Actions cron. |

Detection lag goes from 10–15 minutes to seconds. Nothing else in the system
changes — not the schema, not the scoring, not the alerts, not the web app.

### Still not needed at $7

Redis and BullMQ stay out. A single always-on process running the pipeline in a
loop handles far more than MVP volume. Queues become worth their operational
cost when there are multiple workers to coordinate, which is a scale problem you
do not have and may never have.

## 10. Unchanged

The entire Project Constitution (file 01). The Prisma schema as specced, plus
the additions in §7. The adapter boundary. Deterministic-first. Telegram
templates and the never-shorten-a-contract-address rule. Every non-goal.
