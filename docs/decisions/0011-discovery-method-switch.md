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
`MAX_BLOCKS_PER_RUN` is left at 600 — the new measured rate lands close
enough to the value it was originally sized against that no resize is
justified by this data.

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
