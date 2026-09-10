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

## Navigation, landing-page substance, and footer — added before deployment

Three gaps closed in the same pass, all in `AppHeader`/the landing page:

- **Navigation.** `AppHeader` (global, all three pages) now has a real
  `<nav>`: the wordmark links to `/`, plus a `CONTACTS` link to
  `/opportunities`. Deliberately just those two — the ask was minimal,
  not a menu. At 380px the header was already carrying three elements
  (wordmark, scan status, theme toggle); adding a fourth needed
  compression elsewhere, not a wider header: the scan indicator's
  `"SCAN Xm ago"` text now hides below `sm:` (a bare dot stands in,
  with the same information in a `title` attribute), and the theme
  toggle switched from a text button to an icon-only one (Sun/Moon,
  `lucide-react`, already a dependency).
- **Landing-page substance.** Two new sections between "Watching" and
  the (new) footer: **How it works**, the real pipeline stages in
  order (detect → verify → score → classify → alert, read directly off
  `run-pipeline.ts`'s actual stage sequence — `analyze` excluded since
  `AI_ENABLED` defaults false, 0007, and describing a disabled-by-
  default capability here would overstate what runs today); and **What
  it does not do**, five boundaries lifted verbatim/near-verbatim from
  `01-PROJECT-CONSTITUTION.md` §2-3 (non-custodial, never signs
  transactions, never holds keys, never auto-trades) plus the "not
  financial advice" framing already shipped in 03's Telegram NFA
  disclaimer — each line cites its source inline in the copy, not just
  in this doc, since a trust signal that can't point at where it came
  from isn't holding much weight.
- **Footer**, landing page only (not global — the ask was scoped to
  the landing page). Text labels, not brand icons, matching the app's
  label-driven language elsewhere. GitHub is real
  (`lib/socials.ts`'s `GITHUB_URL`,
  `https://github.com/learnwithtosin/alpharadar`). X is `null` in the
  same file — the footer renders it as a disabled `<span>`
  (`aria-disabled`, `cursor-not-allowed`, a `title` saying so), never an
  `<a>`, so there is no dead link to accidentally ship. Setting `X_URL`
  to a real profile URL is the only change needed once the account
  exists; the footer switches to a live link on its own.

A real bug surfaced fixing the toggle for 380px: `ThemeToggle`'s icon
started from `useState<"dark" | "light" | null>(null)` and rendered
nothing until a `useEffect` resolved the real theme — meaning the
server-rendered HTML (and the first client paint, before hydration)
had an empty button. Confirmed live: `curl`ing a page showed zero
`<svg>` elements where the icon should be. Fixed by starting the state
at `"dark"` — the same value `layout.tsx` already renders on `<html>`
by default — so server and first-client-render output match exactly
(no hydration warning needed) and the button is never blank; `useEffect`
still corrects it afterward on a light-preferring visit, at most a
one-frame icon swap, never an empty control.

## What does not change

0013's scope reasoning (two pages' worth of fields, matched to what the
pipeline actually populates), the `next.config.ts` webpack fix, `isTestData`
filtering, and the WEB_URL/button-omission behavior all stand as written.
0014's accent and chain-identity rules are what this redesign applies,
not a revision of them.

## Capability metrics replace "opportunities detected" as the landing headline; footer goes global

Two further changes, made after the above shipped, supersede two specific
pieces of it: the "live stats" table earlier in this doc (opportunities
detected was one of four headline tiles) and the "Footer, landing page
only" bullet.

**Why "opportunities detected" was the wrong headline stat.** It measures
uptime, not capability — a brand-new, correctly-working system and a
broken one both read **0** on day one. Grant reviewers and anyone who can
check the chain directly would read a low count as "doesn't work" rather
than "hasn't run long." Replaced with five capability metrics, each
either a genuine live query or an explicitly-labeled static fact — never
padded, rounded up, or invented:

| Shown | Source |
|---|---|
| Blocks scanned | `IngestionCheckpoint.totalBlocksScanned`, summed across every watched chain — a new column (`packages/database` migration `20260910100120_add_total_blocks_scanned`), incremented atomically by `checkpoint.ts`'s `advanceCheckpoint` with the exact size of each successful run's range. **Not** derived from `(current − initial) lastBlockNumber`: `getNextRange`'s own doc comment confirms gaps wider than `MAX_BLOCKS_PER_RUN` are permanently skipped, not backfilled, so that subtraction would overstate the real count whenever a skip has happened. Starts at 0 from the migration date forward — does not retroactively account for blocks scanned before the column existed, and the page shows exactly that (confirmed live: reads **0** in dev, the honest number, not a placeholder). |
| Contracts inspected | `prisma.contract.count()` (same query as before, relabeled) |
| Chain height | `IngestionCheckpoint.lastBlockNumber`, most recently updated row (unchanged) |
| Scan latency | **Static, dated, cited — not live.** `discovery.scan.complete` is a structured log line, never persisted to a table, so there is nothing to query for a real-time figure. Shown as "~500 blocks / 153s" — the real measured production scan-phase rate (305ms/block, `docs/decisions/0011`, dated 2026-09-09) at `MAX_BLOCKS_PER_RUN=500` — with a hint noting it's the block-scan phase only (excludes verify/score/alert) and its measurement date, so it reads as a cited fact rather than a live claim. |
| Risk dimensions | **"3 of 6," not "6."** `RiskAssessment` has six nominal dimensions; per `docs/decisions/0006`, only `contractRisk`/`deployerRisk`/`concentrationRisk` are actually computed — `liquidityRisk`/`socialRisk` stay `UNKNOWN` permanently by design, `linkRisk` is partial. Claiming all six "evaluated" would overstate this to anyone who checks a `RiskAssessment` row directly. |

Opportunities detected didn't disappear — it moved to `/opportunities`
(Contacts) as small context text next to the page's own heading
("N opportunities detected"), reusing the same `findMany` result already
fetched for the table rather than a second count query. The user offered
either "lower on the landing page" or "on Contacts, where it's context
rather than a verdict" — Contacts was chosen since it parallels the
footer-global reasoning below: Contacts is where a Telegram alert link
actually lands someone, so it's a more honest home for a number about
what's been found.

**Honest status line.** The hero now shows "Live on {chain} Chain since
{month year}" — e.g. "Live on ROBINHOOD Chain since September 2026" —
so an empty or low detection count reads as *new system*, not *broken
one*. The chain name and date are both derived, never hardcoded: the
earliest `IngestionCheckpoint.createdAt` across every watched chain, and
`chainToken()` (0014's chain-identity map) for the label — the same rule
that already drives the "Watching" badges, applied here too so a second
chain doesn't need new copy, only a new checkpoint row.

**"Sampled, not exhaustive."** Added directly under the stats grid,
next to "Last scan": detection is sampled, not exhaustive, because
`getNextRange`'s skip-not-backfill behavior makes that literally true,
not a hedge — a run behind by more than `MAX_BLOCKS_PER_RUN` permanently
loses the skipped range, per that function's own doc comment. Said
plainly because, per the ask, "someone technical will work it out
anyway."

**Footer goes global.** Previously rendered only in `app/page.tsx`; moved
into `app/layout.tsx` alongside `AppHeader`, so it's present on `/`,
`/opportunities`, and `/opportunities/[id]` — a header on every page and
a footer on only one read as unfinished, and Contacts (reached directly
from a Telegram alert link) needs it as much as the landing page does.
`layout.tsx`'s `<body>` became a column flexbox (`flex min-h-screen
flex-col`) with the page content in a `flex-1` wrapper, so the footer
sits at the true bottom of short pages instead of riding up under a
half-empty viewport. `Footer` itself is unchanged — only where it's
rendered moved.

Confirmed live via `curl` against the dev server after these changes:
the landing page's stats grid shows real dev-database values (`BLOCKS
SCANNED 0`, `CONTRACTS INSPECTED 1`, `CHAIN HEIGHT #58450936`, `SCAN
LATENCY ~500 blocks / 153s`, `RISK DIMENSIONS 3 of 6`), the "Live on
ROBINHOOD Chain since September 2026" line renders from real checkpoint
data, the "sampled, not exhaustive" line is present, `/opportunities`
shows "0 opportunities detected" as context text (not a headline), and
the footer renders on all three pages including `/opportunities/[id]`.
