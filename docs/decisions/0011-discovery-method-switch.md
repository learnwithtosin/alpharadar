# 0011 — Discovery switched from eth_getBlockReceipts to eth_getBlockByNumber + selective eth_getTransactionReceipt

Status: Accepted
Date: 2026-09-09
Related: 0010-rpc-timeout-and-throughput.md (the measurement that triggered this), 0008-erc20-launch-detection.md (`MAX_BLOCKS_PER_RUN` sizing), `ChainAdapter.getRecentContractCreations`'s doc comment (batching history)

## The question

0010 measured `eth_getBlockReceipts` at 0.78 blocks/sec on the now-
authenticated (Alchemy) `ROBINHOOD_RPC_URL`, against an original ~2.6-3.1
blocks/sec assumption — slower, not faster, than the old public endpoint.
Before resizing `MAX_BLOCKS_PER_RUN` off that number, the open question
was whether the RPC *method* itself was the bottleneck: `eth_getBlockReceipts`
returns every receipt (all logs included) for every transaction in a
block, and is a well-known heavily-throttled call on commercial providers,
whereas most blocks in this discovery scan contain zero contract
creations — meaning most of that per-block cost buys nothing.

## What was tested

Same code path (the real `createRpcProvider` transport — retry, timeout,
Cloudflare-challenge detection all included), same authenticated endpoint,
same 600-block range already measured in 0010
(`58029117`-`58029716`, known ground truth: 3 contract creations), so the
three approaches are a direct apples-to-apples comparison:

1. **`eth_getBlockByNumber(block, true)`** (full transactions) per block,
   then **`eth_getTransactionReceipt`** only for transactions where
   `to === null` — most blocks need zero receipt calls.
2. **`eth_getLogs`** across the range, checked for whether a contract
   creation can be identified from log data alone.

## Result 1: eth_getBlockByNumber + selective eth_getTransactionReceipt

**2.83 blocks/sec, 354ms/block average — 3.6x faster than
eth_getBlockReceipts's measured 0.78 blocks/sec, with zero calls over the
5s slow-call threshold (versus 18/600 for eth_getBlockReceipts).** Found
the identical 3 contract creations as the eth_getBlockReceipts baseline —
correctness confirmed, not just speed. Across the 600-block range, only 3
transactions had `to === null`, so only 3 `eth_getTransactionReceipt`
calls were needed on top of the 600 `eth_getBlockByNumber` calls.

**This is close to the original ~2.6-3.1 blocks/sec `MAX_BLOCKS_PER_RUN=600`
was sized against (0008)** — the authenticated endpoint was never
substantially slower in general; `eth_getBlockReceipts` specifically was
the bottleneck. Implemented: `RobinhoodAdapter.getRecentContractCreations`
now uses this approach (see its doc comment and
`ChainAdapter.getRecentContractCreations`'s for the mechanics).

## MAX_BLOCKS_PER_RUN — first attempt (950) was mis-derived, and overran

A real end-to-end `pnpm pipeline` run against production (not the
synthetic RPC-only probe above) measured **600 blocks in 147s —
246ms/block**. That figure was total run time divided by block count, and
was used directly as a scan rate to size `MAX_BLOCKS_PER_RUN=950`. That's
wrong: `total_time / blocks` only approximates the scan rate when
post-scan (verify/score) cost is small relative to the scan — true at low
candidate counts, false in general, since post-scan cost scales with
*candidates found*, not blocks scanned, and candidate count is bursty
(discovery finds a handful of contract creations per hundreds of blocks,
not a steady rate).

The 950-block run this produced overran: **09:22:58 to 09:29:02, 364s
total against the 300s cron** — runs would have started overlapping.
Post-mortem showed two compounding errors, not one:

1. The real scan rate was **305ms/block** (from
   `discovery.scan.complete`'s `avgMsPerBlock`), not 246ms — the earlier
   figure had accidentally-cheap post-scan cost baked in from a
   low-candidate run, and looked like a scan rate by coincidence.
2. Post-scan took **70s for 10 candidates** this run, versus a
   near-negligible amount for the earlier run's 2 candidates — modeled
   in the first attempt as a flat "~1 minute margin" rather than a cost
   that scales with how many candidates a given window happens to find.

## MAX_BLOCKS_PER_RUN — re-derived by budgeting the whole run, resized to 500

Budget every phase of a run, not just the scan: **startup + scan +
post-scan**, each sized from measurement, with the volatile term
(post-scan) sized pessimistically rather than by average.

**Startup**, derived by subtracting the other two measured phases from
the 950-block run's total:

```
364s total - (950 blocks * 305ms/block = 289.75s scan) - 70s post-scan
  = 4.25s  ->  rounded up to 5s
```

**Scan rate**: 305ms/block, taken directly from the measured
`discovery.scan.complete` log line for that run — not re-derived, not
re-averaged with the earlier (wrong) 246ms figure.

**Post-scan cost**: 70s / 10 candidates = **7s/candidate**, taken
directly from the same run. For the candidate-count input, two real runs
exist: 2 candidates (the 246ms/block run) and 10 (this one). Rather than
average them (6 — which is exactly the kind of average that caused the
first overrun), use the **higher observed count, 10**, as a pessimistic
input. This is a floor grounded in what's actually been measured, not an
invented multiplier — but with only two data points, it is not a proof
that 10 is a true worst case; a larger burst remains possible (see the
residual-risk note below).

**Target**: comfortably under the 300s cron. Choosing 240s — 60s (20%)
of headroom under the hard cron ceiling, on top of the pessimism already
built into the 10-candidate assumption.

**Solve for B (blocks)**:

```
startup + B * scanRate + candidates * perCandidateCost <= target
5s + B * 0.305s + 10 * 7s <= 240s
5 + 0.305B + 70 <= 240
0.305B <= 165
B <= 540.98
```

Rounded down to **500** — more of a cut than 0008's or the first attempt
at 0011's ~3% rounding-down convention, deliberately, given this is the
second consecutive miss on this sizing. Worst case at 500 blocks with the
pessimistic 10-candidate assumption:

```
5s + (500 * 0.305s = 152.5s) + 70s = 227.5s
```

227.5s against the 300s cron is 72.5s (24%) of margin — comfortably
under, per the ask, even in the pessimistic case. In the common case
(few candidates), actual run time will be far lower than this, same as
before.

**Residual risk, disclosed rather than hidden**: this sizing assumes
candidate bursts up to 10, the observed maximum. A burst larger than
that (discovery is inherently bursty and n=2 is not enough to bound the
tail) could still push a run over 300s. Sizing alone cannot eliminate
that risk from only two observations. It's bounded, not eliminated, by
the GitHub Actions concurrency guard below: an overrun no longer risks a
checkpoint race, only a skipped/delayed cycle.

`MAX_BLOCKS_PER_RUN` moves from 950 to 500 in `packages/config/src/env.ts`.

## GitHub Actions concurrency guard — not yet wired in; no workflow file exists

Independent of the sizing above — sizing reduces the *chance* of an
overrun, it can't guarantee against one, and two consecutive runs racing
on the same checkpoint row would be a correctness bug, not just a slow
cycle. `checkpoint.ts`'s `getNextRange`/`advanceCheckpoint` assume a
single writer; two overlapping runs would both read the same starting
checkpoint and could both advance it, each unaware of the other's range.

**As of this decision, `.github/workflows/` does not exist in this
repository** (checked across the full git history, not just the working
tree) — the 5-minute cron described in
docs/spec/09-INFRASTRUCTURE-DECISION.md §8 has been a design decision,
not a deployed workflow, up to this point. The guard below is the block
to add to that workflow's YAML once it exists, not something applied to
a file today:

```yaml
concurrency:
  group: alpharadar-pipeline
  cancel-in-progress: true
```

One platform nuance worth being explicit about: GitHub Actions'
`concurrency` key only supports two behaviors for a shared group —
`cancel-in-progress: true` cancels whatever is *currently running* in the
group the moment a new run for that group starts, and lets the new run
proceed immediately; `cancel-in-progress: false` (the default) instead
queues the new run as "pending" until the in-progress one finishes. There
is no third mode that discards a new trigger while leaving an
already-running one untouched. Since queueing is explicitly what's being
avoided here (it would let overrunning cycles stack up back-to-back,
defeating the 5-minute cadence entirely), `cancel-in-progress: true` is
the option that actually prevents overlap — it does so by cancelling the
older, still-running attempt in favor of the freshly scheduled one, not
by skipping the new trigger. That's safe given this pipeline's existing
crash semantics: the checkpoint only advances after a run fully succeeds
(`polling-driver.test.ts` already covers "a crash mid-run does not
advance the checkpoint"), so a cancelled run just loses its own partial
work and the next run re-derives the same starting range — never a
partial or double-advanced checkpoint.

### Repeated cancellation is a silent failure mode — needs a staleness check

`cancel-in-progress: true` prevents a checkpoint race, but it creates a
different failure mode that is silent rather than loud, and it's worth
being explicit about this now even though it isn't fixed here. If runs
consistently take longer than the 5-minute cron interval — the sizing
above is pessimistic, not a guarantee — every run gets cancelled by its
own successor before it can finish. `checkpoint.ts`'s `recordRunFailure`
doc comment already states the mechanism precisely: "A crash mid-run
never even reaches this (the process dies before the catch block runs)."
A GitHub Actions cancellation kills the process the same way a crash
does. So in sustained overrun:

- `lastBlockNumber` never advances (expected — that's what "the range
  stays unprocessed" is for).
- `lastRunAt` *also* never advances, because `recordRunFailure` — the
  only thing that touches it on a failure path — never runs either.
- GitHub Actions reports each of these as a **cancelled** run, not a
  **failed** one, which is a different status with different default
  notification behavior — nothing here is guaranteed to alert anyone.

The net effect: detection silently stops, the checkpoint sits frozen,
and there is no error anywhere in the system to notice. This is worse
than a loud failure, not better.

**This needs a check when the workflow is actually built (Prompt 8)**:
something outside the pipeline process itself — since the pipeline
process is exactly what's being killed — that watches
`IngestionCheckpoint.lastRunAt` for staleness (e.g., older than some
multiple of the 5-minute cadence) and surfaces a real alert when it's
gone stale, rather than relying on the absence of a GitHub Actions
failure notification to mean everything is fine. Not implemented here —
flagged so it isn't lost between now and when that workflow is written.

## Result 2: eth_getLogs — a receipt (or transaction) is unavoidable

Two findings settle this:

- **Structurally**: a JSON-RPC log object (confirmed live, both in this
  investigation and previously in `getLogs`'s own doc comment) carries
  `address`, `topics`, `data`, `blockNumber`, `transactionHash`,
  `logIndex`, `removed` — no `contractAddress`, no `to`. Contract creation
  is a property of a transaction (`to === null`) or a receipt
  (`contractAddress !== null`), not a log event. The EVM's `CREATE`/
  `CREATE2` opcodes emit no log of their own; any event a constructor
  happens to emit is optional, unstandardized, and not present for every
  contract, so it's not a reliable general signal.
- **Operationally**: an unfiltered `eth_getLogs` call across the same
  600-block range was tried live and failed outright (`400`) — consistent
  with `getLogs`'s existing doc comment that this endpoint requires an
  address filter and fails fast without one. Since discovery doesn't know
  the address in advance (that's the point of discovery), this path isn't
  viable even as a heuristic.

`eth_getLogs` cannot replace a receipt/transaction read for this purpose.
Not implemented; no code change from this option.

## Why eth_getBlockReceipts was slow: Alchemy's compute-unit pricing

Alchemy publishes per-method compute-unit (CU) costs and separately
prices *throughput* CU, which is what per-second rate limiting is actually
measured against (a request costing more throughput CU consumes more of
the reserved CUPS budget, independent of its plain CU cost). Per Alchemy's
docs (alchemy.com/docs/reference/compute-unit-costs,
alchemy.com/docs/reference/compute-units):

| Method | Throughput CU |
|---|---|
| `eth_getBlockReceipts` | 500 |
| `eth_getLogs` | 60 |
| `eth_getBlockByNumber` | 20 |
| `eth_getTransactionReceipt` | 20 |

`eth_getBlockReceipts` costs **25x** the throughput CU of
`eth_getBlockByNumber`/`eth_getTransactionReceipt` — it returns every
receipt (every log) for every transaction in the block regardless of
whether any of them are relevant, which is exactly the "large dataset,
high processing cost" pattern the docs associate with a high throughput-CU
price. This is consistent with, and explains, what was measured: not an
endpoint-wide slowdown, but one method being disproportionately expensive
to call at volume.

## What does not change

The per-block sequential, never-batched pattern from the original
batching investigation (0008) — this was never re-tested for the new
methods and there's no reason to assume it would behave differently under
sustained load. The 10s per-request timeout and Cloudflare-challenge
detection from 0009/0010, unaffected by which method is called. The
discovery-scan instrumentation (`discovery.scan.*` log events) from 0010,
now also covering `eth_getTransactionReceipt` calls with a `method` field
so a slow receipt call is distinguishable from a slow block call in the
log.
