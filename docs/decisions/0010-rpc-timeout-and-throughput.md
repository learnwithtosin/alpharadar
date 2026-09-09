# 0010 — RPC timeout regression fixed; authenticated endpoint measured slower, not faster, for eth_getBlockReceipts

Status: Accepted
Date: 2026-09-08
Related: 0009-rpc-cloudflare-challenge.md (the custom transport this timeout was missing from), 0008-erc20-launch-detection.md (`MAX_BLOCKS_PER_RUN` sizing, now in question)

## What triggered this

A production run took ~22.5 minutes against a 600-block/~4-minute budget
(0008). Leading hypothesis: switching `RobinhoodAdapter` to a custom viem
transport (0009, for Cloudflare-challenge detection) silently dropped
viem's own `http()` transport's default request timeout, so a handful of
slow/hanging connections could block far longer than before.

## Fix 1: explicit per-request timeout

Confirmed from viem's own source (not assumed) that `http()` defaults
`timeout` to `10_000`ms. `rpc-client.ts`'s `createRpcProvider` now enforces
the same default via `AbortController`, thrown as a new, distinctly-named
`RpcTimeoutError` (not confused with `CloudflareChallengeError` or
`RpcHttpError`) and retried the same way. Regression closed regardless of
whether it explains the 22 minutes — it doesn't, fully (see below), but it
was a real gap on its own.

## Fix 2: discovery-scan timing instrumentation

`getRecentContractCreations` now logs `discovery.scan.start`,
`discovery.scan.progress` (every 50 blocks), a `discovery.scan.slow_call`
warning for any single call over 5s, and `discovery.scan.complete` with
totals. Routed through a small injectable `AdapterLogger`
(`packages/chain/src/logger.ts`) that apps/pipeline wires to its own `log`
module, so this reads in the same stream as everything else, not a
separate console output. This is what actually answered the question —
see below.

## Fix 3: DB retry extended past checkpoint calls

The same production run also hit `Can't reach database server at
...pooler.supabase.com:6543` on a plain per-candidate `contract.findUnique`
in `ingest.ts` — a call the retry wrapper (0009... actually the DB-retry
turn, see checkpoint.ts's history) was never applied to, since it was
explicitly scoped to checkpoint reads/writes only at the time. Extracted
the retry helper out of `checkpoint.ts` into a shared `db-retry.ts` and
applied it to `ingest.ts`'s `contract.findUnique` too. Same rule as
before: connection-level failures only (`Prisma.PrismaClientInitializationError`),
never real query errors.

## Measured throughput on the authenticated endpoint — slower, not faster

With the timeout fix in place (so no call can hang past 10s) and the new
instrumentation, ran the real adapter method against 600 live blocks on
the now-configured authenticated provider endpoint (`ROBINHOOD_RPC_URL`).
Full result:

- **600 blocks in 769.9s (12.8 minutes) — 0.78 blocks/sec, 1,283ms/block
  average.**
- **18 of 600 calls (3%) were "slow" (>5s)**, each one actually multiple
  stacked retry attempts (elapsed times of 7.4s–29.2s — bigger than the
  10s single-call timeout, meaning 2–3 attempts per slow block). Those 18
  calls alone account for ~249s — **32% of total run time** — despite
  being 3% of calls.
- Excluding those 18, the remaining 582 "normal" calls still averaged
  **~894ms/block** — slower than the ~350ms/block measured against the
  public endpoint in earlier sessions (docs/decisions/0009 and the
  batching investigation before it).

**The authenticated endpoint is not "substantially faster" for
`eth_getBlockReceipts` — on this measurement, it's slower, both in normal-
case latency and in how often a call needs multiple retry attempts to
succeed at all.** This wasn't the expected outcome and is reported as
measured, not adjusted to fit the expectation. The timeout fix did its
job — nothing hung indefinitely, everything completed within bounded
retries — but it doesn't explain away the 22-minute production run: the
underlying calls are, empirically, just slow on this endpoint for this
specific method, and retrying a slow call with backoff makes a single
run take longer, not shorter, even though each individual attempt is now
correctly bounded.

One thing this doesn't rule out: `eth_getBlockReceipts` may be an
unusually expensive method for the provider to serve (it returns every
receipt, including logs, for every transaction in a block) compared to
lighter methods (`eth_blockNumber`, `eth_getLogs`) — plausible given the
pattern (slowness concentrated on this one method), but not confirmed
against provider documentation or support, so stated as a hypothesis, not
a fact.

## `MAX_BLOCKS_PER_RUN` — recommendation, not changed here

0008 sized `MAX_BLOCKS_PER_RUN=600` for a ~4-minute run at a since-revised
~2.6 blocks/sec. Measured now: 0.78 blocks/sec — **worse**, not better.
At this rate, 600 blocks costs ~12.8 minutes even without the production
run's additional DB-retry delay. The user's own stated conditional was
"if it's substantially faster, raise it" — it measured slower, so this
decision does **not** raise `MAX_BLOCKS_PER_RUN`, and flags that the
current value may now need to come *down* to fit a sane run/cron budget,
or the discovery method/provider needs its own follow-up — left as an
open decision for the user given this contradicts the working assumption
the value was set under.

**Follow-up**: the discovery method was the actual bottleneck, not the
endpoint — see docs/decisions/0011-discovery-method-switch.md, which
replaces `eth_getBlockReceipts` with `eth_getBlockByNumber` + selective
`eth_getTransactionReceipt` and resizes `MAX_BLOCKS_PER_RUN` (950 first,
then 500 after that first resize overran the cron — see 0011's full
derivation and the GitHub Actions concurrency guard it adds).

## What does not change

The checkpoint's accepted-gap semantics; the per-candidate resilience
pattern in `ingest.ts`; the Cloudflare-challenge detection and retry
behavior from 0009, now correctly bounded per attempt by the timeout
fixed here.
