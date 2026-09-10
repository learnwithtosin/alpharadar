# 0017 — Header off the TTFB critical path, landing stats cached, one spacing scale replaces per-section guesswork

Status: Accepted and implemented
Date: 2026-09-10
Related: docs/decisions/0016-web-db-resilience.md (0016 fixed crash-safety on the Supabase pooler blip; this fixes the latency 0016 explicitly left alone — "wrapping it in try/catch stops it crashing; it doesn't stop it blocking")

## Performance: two architectural fixes, measured

**1. `AppHeader` no longer blocks the shell.** It was an `async` Server
Component awaiting `IngestionCheckpoint.findFirst` inline, rendered in
the root layout — so every page's entire HTML response, not just the
scan indicator, waited on that query (plus every retry delay on a
connection blip) before a single byte could be sent. Split into a
synchronous `AppHeader` (nav + theme toggle, no query) and an async
`ScanIndicator` streamed in via `<Suspense fallback={<ScanIndicatorSkeleton />}>`.
The skeleton matches the real content's shape at both breakpoints (a
muted pulsing bar+dot at `sm:`+, just a dot below it) so nothing shifts
size when the real content arrives. `ScanIndicator` still degrades to
`null` on a failed read (0016's behavior), now on top of never blocking
in the first place.

**2. Landing page stats cached 60s via `unstable_cache`.** Explicitly
not real-time numbers ("blocks scanned," "contracts inspected," etc. —
the whole point of 0016's framing was that these are capability metrics,
not live state), so every request re-querying Frankfurt for them was
paying a network round-trip for a number that's correct for a full
minute. `unstable_cache` persists its entries as JSON, and Prisma's
`bigint` columns (`lastBlockNumber`, `totalBlocksScanned`) and `Date`
fields aren't JSON-serializable — rather than gamble on undocumented
cache-internals behavior, the cached function returns a plain-string DTO
(`CachedCheckpoint`) and the caller reconstructs real `BigInt`/`Date`
values immediately after, so every downstream line (the
`totalBlocksScanned` reduce, `chainToken`, `formatMonthYear`,
`formatAge`, `isFresh`) keeps working against the exact types it always
has — only the fetch functions changed, not the render logic. Confirmed
the cache is actually being hit (not just configured and silently
bypassed) with a temporary probe: the underlying query ran once on a
cold request and zero additional times across two immediately-following
requests, then removed before shipping.

`/opportunities`' own query stays deliberately uncached — per 0016, it's
that page's reason for existing (its own data, not decoration), so it
must stay live per docs/decisions/0013.

**Measured, not felt** — `next build && next start` (a real production
build; `next dev`'s on-demand compilation makes dev-mode timings
meaningless for a before/after comparison), `curl -w
"%{time_starttransfer}"`, 8 requests per route, median reported. Neither
run logged a single `db.retry`, so neither number is a blip artifact —
this is the architecture's own effect, not noise:

| Route | Before (median) | After (median) | Change |
|---|---|---|---|
| `/` | 1.371s | 0.030s | ~46x faster |
| `/opportunities` | 1.264s | 1.387s | No meaningful change |

`/` improves by roughly two orders of magnitude — the Frankfurt round
trip is off its critical path entirely (header streams, stats serve from
cache). `/opportunities` is flat, honestly reported rather than
oversold: its own opportunity-list query was never a caching candidate
(it must stay live), so it remains the dominant cost, and removing
`AppHeader`'s contribution to the critical path didn't move a number
that was already dominated by a different, necessarily-uncached query —
the small increase across runs is ordinary network jitter to Frankfurt,
not a regression (the two ranges overlap).

## Spacing: one scale, defined once, applied explicitly — no first-child trick

**Root cause**, found by reading the actual rendered HTML rather than
guessing again: `BracketHeader` carried `mt-12 first:mt-0` — intended to
put a consistent gap above every section label, skipped only when the
label happened to be a page's very first element. In practice, almost
every section wraps a lone `BracketHeader` as the first child of its own
`<section>`/`<div>`, so `first:mt-0` fired every time and silently
canceled the `mt-12` it was supposed to gate — not just on the landing
page's WATCHING/HOW IT WORKS/WHAT IT DOES NOT DO (confirmed live via
screenshot: each jammed directly against whatever preceded it, zero
gap), but on the detail page's RISK CLASSIFICATION, SCORE INPUTS, and
EVIDENCE too, which had never been screenshotted for this before. The
only places that happened to look right were places where a *different*
element's incidental padding (the hero's `sm:py-24` bottom padding, the
CONTRACT column's own explicit `mt-12 lg:mt-0` wrapper) accidentally
supplied the gap `BracketHeader` had silently failed to.

**Fix**: spacing responsibility moved out of `BracketHeader` entirely
and into two explicit, named values, defined once
(`apps/web/lib/spacing.ts`):

- `SECTION_GAP` (`mt-16 sm:mt-20`) — the gap between one section and the
  one before it. Applied by a new `<Section>` component
  (`apps/web/components/section.tsx`), used for every section on the
  landing page and the two previously-unwrapped blocks on the detail
  page (RISK CLASSIFICATION; the SCORE INPUTS + EVIDENCE row). `first`
  opts a page's opening section (the landing hero) out of the gap — it
  supplies its own opening space via padding instead, so hero's
  className dropped its bottom padding (`sm:py-24` on both sides →
  `sm:pt-24`, top only) and lets the *next* section's `SECTION_GAP`
  supply that boundary instead, keeping every inter-section gap on the
  page driven by the same one value rather than one section's top
  margin plus a different section's bottom padding happening to add up
  to something reasonable.
- `LABEL_GAP` (`mb-4`) — the gap between a `BracketHeader` label and its
  own content below, which is all `BracketHeader` owns now. Explicit,
  not `first:`-conditional, so it can't silently zero itself out again
  depending on sibling structure.

Confirmed live via screenshot after the change: WATCHING, HOW IT WORKS,
and WHAT IT DOES NOT DO all show real, consistent breathing room above
their labels; RISK CLASSIFICATION, SCORE INPUTS, and EVIDENCE on the
detail page do too, matching the same scale.

## "How it works" cards: equal height confirmed, connectors removed

The five pipeline-stage cards were already equal height at the reported
breakpoint — screenshotted and measured before touching anything, not
assumed: the outer flex row's `items-stretch` plus each `flex-1`
pair-wrapper's own `items-stretch` did produce matching card heights.
What was genuinely cramped was the connector: a `ChevronRight` squeezed
into a `px-1 py-2` gap between cards, nested two flex levels deep purely
to keep an arrow glyph aligned. Simplified per the second option offered
("give the cards equal height... or remove the connectors"): dropped the
flex/pair-wrapper/chevron structure for a plain
`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3` — CSS Grid's own
row-track sizing makes every cell in a row equal height by default, so
equal height is now a property of the layout primitive itself rather
than three levels of `items-stretch` coordinating to produce it, and
there's no connector left to keep aligned across breakpoints. Text stays
top-aligned (the unstyled block default — nothing needed to force it).
