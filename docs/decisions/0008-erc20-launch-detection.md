# 0008 — Slice 1 targets ERC-20 launches, not ERC-721 mints; wider discovery window

Status: Accepted
Date: 2026-09-08
Supersedes: the Slice 1 detector target implied by 09 §5/§11 point 4 ("a new ERC-721 contract... plus its first mint activity")
Related: 0002-scheduled-polling.md (cron cadence), the discovery-source switch from `getRecentlyVerifiedContracts` to `getRecentContractCreations` (see `ChainAdapter.getRecentContractCreations`'s doc comment for the RPC batching investigation that produced it)

## Decision

Slice 1's active detector is now: a new ERC-20 contract plus its first
on-chain activity (a mint — Transfer from the zero address — or an
ordinary transfer, whichever comes first). The original ERC-721-new-
contract-plus-mint detector is kept fully intact, unconditionally, running
every cycle alongside the ERC-20 one — not deleted, not gated behind a
flag. If NFT activity appears on this chain later, it is caught without
any further code change.

`MAX_BLOCKS_PER_RUN` rises from 150 to 600, and the GitHub Actions cron
cadence (not yet deployed, but specified in 09 §8) moves from every 10
minutes to every 5.

## Why: the base-rate survey

At 150 blocks/run (the value in place at the time), a live run against
mainnet processed its window in 58s and found 1 contract creation, 0
ERC-721. That's consistent with an actual absence of NFT activity, not a
detector bug — confirmed by a dedicated live survey.

**Method**: 20 independent windows of 150 blocks each, spread evenly
across the most recent ~3 hours of chain activity (spacing ~5,346 blocks
apart, so no window overlaps another), scanned via unbatched sequential
`eth_getBlockReceipts` at the proven-safe rate. Every contract creation
found was classified via Blockscout's `/v2/tokens/{address}` and checked
for Transfer-log activity in the 50 blocks after its creation block.

**Result** — 3,000 blocks scanned, 14 contract creations found:

| | Count | Rate |
|---|---|---|
| Contract creations (any kind) | 14 | 4.67 / 1,000 blocks, ~166 / hour |
| ERC-721 | **0** | **0 / 1,000 blocks, ~0 / hour** |
| ERC-20 | 1 (had mint activity) | 0.33 / 1,000 blocks, ~11.9 / hour |
| ERC-1155 | 0 | — |
| Plain contracts (not a token) | 12 | — |
| Indexer-unclassified | 1 | — |

Zero ERC-721 deployments across all 20 independent windows, not just a
quiet window or two — this chain's current activity is dominated by
plain contracts and token-launcher-style ERC-20s, not NFT collections. An
early-detection product cannot target an event this chain isn't
producing. ERC-20 launches are themselves rare (~1 in 3,000 blocks in
this sample) but real, observed, and non-zero.

> UPDATED — re-verified after a production run reported 19 creations in
> 600 blocks (31.7/1,000), ~7x this survey's rate. Checked mechanically
> whether Blockscout classification failures explained it — they can't:
> "total creations" comes entirely from `getRecentContractCreations`
> (raw block-receipt scanning), which never called Blockscout in either
> survey; classification only affects the type split, not the count.
> Re-ran the same 20-window/3,000-block methodology through the real
> `RobinhoodAdapter` end-to-end (RPC-only classification, zero
> Blockscout calls): **34 creations/3,000 blocks (11.33/1,000,
> ~404/hour), ERC-721 still 0, ERC-20 6 (2.0/1,000, ~71.3/hour), 28 not
> a token.** Per-window counts ranged 0–5 (0–33/1,000) *within this one
> survey* — a wider spread than the gap between the two surveys'
> averages. Conclusion: this chain's deployment activity is genuinely
> bursty, not a measurement artifact; the table above is a snapshot, not
> a stable constant. **ERC-721-absent holds — now confirmed across a
> doubled, methodologically cleaner combined sample (6,000 blocks, 48
> creations, 0 ERC-721) — so the core decision stands.** The rate
> figures in the table are stale on the low side; treat ~11/1,000 total
> and ~2/1,000 ERC-20 (~71/hour) as the more current estimate.
> `MAX_BLOCKS_PER_RUN` is unaffected — it's sized by RPC throughput, not
> base rate (see below).

## Why keep the ERC-721 path instead of deleting it

Zero-in-a-3-hour-sample is not zero-forever. Ripping the detector out
would mean rebuilding it from scratch the day NFT activity does appear,
and re-doing work already validated (Transfer-from-zero mint detection,
confirmed live in an earlier session against a real mint). Both detectors
share discovery (`getRecentContractCreations`), classification
(`getTokenMetadata`), and the dedup/resolve machinery — running both
costs nothing extra per candidate beyond the classification call every
candidate already needs.

## Coverage window: 150 → 600 blocks

A real run measured 150 blocks in 58s (~2.59 blocks/sec end-to-end,
including enrichment reads and checkpoint writes — slower than the
synthetic RPC-only probe's ~3.1/s, which measured raw `eth_getBlockReceipts`
calls alone). At that rate, a ~4-minute run budget is a ceiling of
~621 blocks (240s × 2.59). `MAX_BLOCKS_PER_RUN=600` leaves a small margin
below that ceiling.

At 150 blocks/run on a 10-minute cron, the pipeline sampled roughly 2.5%
of each 10-minute window — a rare event (an ERC-20 launch, ~166 creations
overall but far fewer of those being actual token launches) could
plausibly go undetected for a long time under that little coverage.
600 blocks/run on a 5-minute cron raises the sampled fraction
substantially (600 blocks ≈ 61s of chain time at ~9.9 blocks/sec, against
a 5-minute/~300s window ≈ 20% coverage) without changing the accepted-gap
model from 0002/checkpoint.ts: a run still scans only its most recent
window and does not backfill past it.

## What does not change

The pipeline stage boundaries (ingest → resolve → verify → score →
analyze → alert), the checkpoint mechanism and its accepted-gap semantics
(0002, as amended above), the dedup key `(chain, contractAddress, type,
actionProfile)` on open opportunities, `runPipeline`'s driver-agnostic
signature. ERC-20 signals flow through the exact same
`findOrCreateOpportunity` dedup call as ERC-721 signals always have —
just with `type: TOKEN_LAUNCH` and `actionProfile: TRADE_RESEARCH`
instead of `NFT_MINT`/`FREE_MINT` and `MINT`.
