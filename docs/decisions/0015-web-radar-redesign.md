# 0015 — Radar/signal-intelligence redesign shipped: responsive, motion, landing page

Status: Accepted and implemented
Date: 2026-09-10
Related: docs/decisions/0013-web-opportunities-pages.md (supersedes its "dark by default... no theme toggle" section — everything else there stands), docs/decisions/0014-web-visual-identity.md (the accent/chain-identity rules this redesign applies)

## What changed from 0013's first pass

0013 shipped a functional but visually plain version of `/opportunities`
and `/opportunities/[id]` — one typeface, monospace throughout, a single
accent color spread across brackets/rules/labels, dark-only with no
toggle. Iterated through a standalone HTML preview (not committed —
scratch, deleted once it had served its purpose) to land on a direction
before touching the real app: radar/signal-intelligence framing (score
as signal strength, risk as threat classification, age as time-since-
contact), a display face reserved for headings/labels/the score with
monospace pulled back to strictly data (addresses, score inputs, chain
field values), and a disciplined accent (0014) used in exactly three
places rather than as texture. This decision covers landing that
direction in the real app, plus three things the preview couldn't
resolve on its own: genuine responsiveness, motion tied to real data,
and a third page.

## Responsive: designed at three widths, not centered at one

The preview was phone-first by necessity (a fixed-width mockup); the
real detail page now reflows structurally, not just re-centers, at three
breakpoints:

- **Mobile (base)**: single column — hero, then contract, then risk
  grid (2 columns), then score inputs, then evidence, stacked in that
  order.
- **Medium (`md:`, ~768px)**: risk grid widens to 3 columns.
- **Large (`lg:`, ~1024px+)**: hero and the contract panel sit side by
  side (`grid-cols-[1.3fr_1fr]`, hero weighted wider since it's the
  priority column); score inputs and evidence share a row.

The five-second test governs at every width: the hero column (score,
threat class, why) is always the first thing in document order and
never competes with or waits on the contract column, which sits beside
it at `lg:` and below it, never above it, at every narrower width.

## Motion: three real, deliberately non-continuous animations

- **Scan indicator** (`AppHeader`, all three pages): queries
  `IngestionCheckpoint` directly and shows the real
  `lastRunAt` age. The dot pulses only when that run was within
  `SCAN_FRESHNESS_THRESHOLD_MS` (10 minutes — roughly two 5-minute cron
  cycles, enough slack for GitHub Actions' cron being best-effort per
  09 §4, without calling a merely-late run stale); older than that, the
  same dot renders with no animation class at all. Confirmed live: the
  dev checkpoint was genuinely 22 hours stale while building this, and
  the header correctly showed a static dot and "SCAN 22h ago" — the
  stale state 0013 could describe but not demonstrate is now real and
  was seen rendering, not just coded.
- **Freshness dot** (detail page's "ACQUIRED" line, each list row): same
  mechanism, keyed to `detectedAt` against a separate, looser
  `FRESHNESS_THRESHOLD_MS` (30 minutes — several cron cycles, so "still
  pulsing" means "genuinely recent," not decoration that never turns
  off).
- **Score entrance**: a single 0.35s fade/rise on the score numeral,
  starting from 0.6 opacity (never fully hidden, so it never delays the
  number being readable) and skipped outright under
  `prefers-reduced-motion: reduce`. No other element animates on load.

Nothing else moves. No looping decoration, no hover-triggered flourishes
beyond ordinary link/button states.

## The landing page: real numbers or no numbers

`/` was a placeholder before this; it's now the shareable artifact
itself — a hero, a live stats band, what chains are watched, and what
the product does. Every number on it is a direct query, not a
placeholder or a rounded-up guess:

| Shown | Source |
|---|---|
| Last scan | `IngestionCheckpoint.lastRunAt`, most recently updated row |
| Chain height | `IngestionCheckpoint.lastBlockNumber` on that same row |
| Contracts observed | `prisma.contract.count()` |
| Opportunities detected | `prisma.opportunity.count({ where: { isTestData: false } })` |
| Chains watched | every distinct `IngestionCheckpoint.chain`, through `chainToken()` (0014) |

Confirmed live rather than assumed honest: at the time this was built,
opportunities detected read **0** (the only row in the database is
`isTestData` fixture data) and the chain hadn't scanned in 22 hours —
the page shows exactly that, not a more flattering number. No
testimonials, no screenshots, no copy claiming a capability the pipeline
doesn't have (the "What it does" section's four blurbs — detect, score,
classify risk, alert — each describe a real, already-shipped mechanism,
named specifically: the deterministic score with stored inputs, the risk
veto, UNKNOWN staying UNKNOWN).

## Typography and the display font

Space Grotesk, loaded via `next/font/google` (not a `<link>` tag) —
self-hosted at build time, so it carries zero runtime dependency on
Google's CDN once built; confirmed the production build embeds real
`.woff2` files under `.next/static/media/`, not a live font request.
Reserved for headings, the score, labels, tags, and body prose;
monospace (the existing system stack) stays scoped to literal data —
addresses, score-input key/value pairs, chain field values — per the
explicit "keep monospace for what should read as data" instruction this
redesign was built against.

## Theme toggle: supersedes 0013

0013 shipped dark-only with no toggle, reasoning there was no settings
page yet to hold a preference. This decision adds a real one
(`components/theme-toggle.tsx`) — a small client component, no settings
page needed: it persists to `localStorage` directly, and an inline
synchronous script in `app/layout.tsx`'s `<head>` (the standard no-flash
pattern) applies the stored preference — or `prefers-color-scheme` on a
first visit — before first paint. Dark stays canonical: it's the
server-rendered default class on `<html>`, overridden to light only when
a stored or system preference says so.

## What does not change

0013's scope reasoning (two pages' worth of fields, matched to what the
pipeline actually populates), the `next.config.ts` webpack fix, `isTestData`
filtering, and the WEB_URL/button-omission behavior all stand as written.
0014's accent and chain-identity rules are what this redesign applies,
not a revision of them.
