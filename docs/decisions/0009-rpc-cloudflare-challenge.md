# 0009 — Public RPC serves intermittent Cloudflare challenges; pipeline now survives rather than avoids it

Status: Accepted
Date: 2026-09-08
Related: 0002-scheduled-polling.md (checkpoint/retry semantics), `ChainAdapter.getRecentContractCreations`'s doc comment (the earlier RPC batching investigation — a related but distinct finding about the same endpoint)

## What was observed

In production, `rpc.mainnet.chain.robinhood.com` returned a `403` with
`cf-mitigated: challenge` on an `eth_getBlockReceipts` call — a Cloudflare
managed-challenge response (the "Just a moment..." interstitial) instead
of a JSON-RPC result. This is the same failure mode already confirmed
against the Blockscout REST API earlier in this project (see the
`getTokenMetadata` RPC-migration decision) — Cloudflare sits in front of
both this chain's explorer and its public RPC endpoint.

## Could not reproduce on demand

Two live probes, both against the real endpoint, found nothing:

1. **Light load**: 7 calls to `eth_blockNumber`, spaced 75s apart over
   ~8.75 minutes, plain requests (no custom headers, nothing aimed at
   passing a challenge). 6 of 7 succeeded cleanly with `cf-mitigated:
   none`; the 7th was a bare connection error ("fetch failed" — no HTTP
   response at all), not a challenge signature.
2. **Real load shape**: 200 sequential, unbatched `eth_getBlockReceipts`
   calls — the exact call pattern a real run makes, at the proven-safe
   ~3/sec pace — completed in ~88 seconds with zero challenges. Every
   single call returned `200` with `cf-mitigated: none`.

**Conclusion: the challenge is real (it happened in production) but
intermittent, and its trigger condition (time-of-day, cumulative load
across a longer session, something else entirely) was not isolated.**
Given that, the correct response is not "avoid whatever triggers it" —
that's unknown — but "survive it when it happens."

## Decision

1. **`CloudflareChallengeError`** (`packages/chain/src/errors.ts`) is a
   distinct, named error class, not a generic HTTP or parse failure.
   `RobinhoodAdapter` no longer uses viem's own `http()` transport;
   `createRpcProvider` (`packages/chain/src/rpc-client.ts`) is a raw-fetch
   EIP-1193 provider passed to viem's `custom()` transport instead, so
   *every* RPC call — viem's high-level actions and this adapter's
   hand-rolled raw `client.request()` calls alike — goes through the same
   detection, not just the couple of calls that happen to bypass viem's
   formatting layer already. A challenge (detected via `cf-mitigated:
   challenge`, or a 403 with an HTML/"Just a moment" body) is retried with
   backoff exactly like a plain 429/5xx (`RpcHttpError`); a genuine
   JSON-RPC error (bad params, etc.) is never retried. If a challenge
   still hasn't cleared after the retry budget, it's thrown as
   `CloudflareChallengeError` and the run fails cleanly:
   `polling-driver.ts` records the failure (checkpoint left unadvanced,
   same as any other failure — see 0002) and emits a dedicated, greppable
   `pipeline.rpc.challenged` log line — distinct from the generic
   `pipeline.run.failed` line — specifically so this reads unmistakably in
   a GitHub Actions log rather than being buried in a stack trace. This
   also closes a latent gap: `getLatestBlockNumber()` (the very first RPC
   call of every run) was previously outside the driver's try/catch, so a
   failure there would have bypassed `recordRunFailure` and structured
   logging entirely; it's now covered by the same block.

2. **`ROBINHOOD_RPC_URL` is confirmed the single source of truth for the
   RPC endpoint.** Audited every place a URL could be constructed or
   defaulted: `RobinhoodAdapterOptions.rpcUrl` is required with no
   fallback; `apps/pipeline/src/index.ts` passes `env.ROBINHOOD_RPC_URL`
   straight through with no transformation. The one other place a URL
   literal existed — `robinhoodChain`'s viem `Chain` definition
   (`rpcUrls.default.http`) — is inert for actual requests (confirmed
   against viem's own source: `createClient`/`createPublicClient` never
   reads `chain.rpcUrls` when an explicit `transport` is supplied, which
   this adapter always does) but was annotated in place so a future reader
   doesn't mistake it for load-bearing config. Swapping to an
   authenticated provider is a `.env`/CI-secret change, not a code change.

## What does not change

The checkpoint's accepted-gap semantics (0002/checkpoint.ts) — a run that
fails on a persistent challenge leaves the checkpoint exactly where it
was, same as any other failure, and the next run retries the same range.
The per-candidate resilience in `ingest.ts` (one candidate's enrichment
failing degrades to unknown and continues) is unchanged — a
`CloudflareChallengeError` there is caught the same as any other error,
which is correct: a challenge during *discovery* (the highest-volume call,
and the one actually observed) still aborts the run as intended, while an
isolated challenge during one candidate's enrichment degrades gracefully
like any other transient failure.
