# 0013 — apps/web implemented: /opportunities and /opportunities/[id]

Status: Accepted
Date: 2026-09-10
Related: docs/spec/02-MVP-TECHNICAL-SPECIFICATION.md §15-17 (web pages, NFT/token detail pages), docs/decisions/0012-telegram-alert-stage.md (the "Open on AlphaRadar" link these pages are the destination of), docs/decisions/0006-risk-and-token-page-unknowns.md (the unknowns these pages must show honestly)

## Scope: two pages, not the full §15-17 list

02 §15 lists ten required pages; §16/§17 describe separate NFT and Token
detail pages with fields (price, supply, minted/remaining, liquidity,
volume, holder count...) this MVP's actual pipeline never populates —
nothing in `ingest.ts`/`verify.ts`/`score.ts` produces that data for
either opportunity type. Built exactly what was asked instead: one
generic `/opportunities/[id]` (the schema has one `Opportunity` model,
not a NFT/Token split) showing contract address with a copy button,
verification status, deployer, a full risk breakdown with unknowns shown
as unknown, score with its stored inputs made visible, evidence with
sources, and the official action link where one exists — every field on
that list maps to something the pipeline actually writes. Building UI for
fields nothing populates would be decoration, not information — exactly
what "no decoration between the user and the decision" argues against.

## A real bug found and fixed: Next.js couldn't resolve this monorepo's own packages

First `next dev` run of a page that imports `@alpharadar/database` (and
transitively `@alpharadar/config`) failed outright:
`Module not found: Can't resolve './load-env.js'`. Root cause, confirmed
by reading the actual failure, not guessed: every workspace package in
this repo uses explicit `.js`-extension relative imports pointing at
`.ts` source (`packages/config/src/index.ts`'s `import "./load-env.js"`)
— standard NodeNext-style ESM, which `tsx`/`tsc` (moduleResolution
"Bundler") resolve correctly, apps/pipeline runs under `tsx` so never hit
this, but Next's webpack bundler treats `.js` as a literal extension and
never tried `.ts` in its place. `transpilePackages` (already configured)
handles *transpiling* these packages' TypeScript; it does nothing for
*resolving* their internal `.js`-that-means-`.ts` import specifiers — a
distinct problem apps/web had simply never exercised before this task,
since neither of its two pre-existing files imported a workspace package
with this pattern.

Fixed in `next.config.ts` with a `webpack.resolve.extensionAlias`
(`{".js": [".ts", ".tsx", ".js"]}`) — tells webpack to also try `.ts`/
`.tsx` before a literal `.js` when resolving any specifier ending in
`.js`. Confirmed live: both pages 500'd before this, both 200 after, with
a clean dev-server log (no warnings) on every subsequent request. This
will affect every future apps/web page that reaches into
`@alpharadar/*` — worth knowing it's a monorepo-wide fix, not a
one-page patch.

## Design: dark by default, dense, no theme toggle

**Superseded by docs/decisions/0015-web-radar-redesign.md** — a full
visual redesign (typography, accent discipline, a real theme toggle,
responsive layout, real motion) shipped shortly after this decision.
Left below as the historical record of the first pass, not the current
state.

`.dark`'s CSS variables were re-tuned off shadcn's stock dark gray toward
a near-black, tighter-contrast palette, and `<html>` carries the `dark`
class unconditionally in `layout.tsx` — not a toggle, since there's no
settings page yet to hold a preference and the ask was for one specific
look, not a configurable one. Body font is the system monospace stack
(`font-mono`) — numeric alignment (scores, timestamps, addresses) reads
cleaner monospaced, and it reads unmistakably as a terminal rather than a
marketing site without needing a custom font (no external font fetch,
also sidesteps this session's demonstrated network flakiness for
anything hitting an external host).

Risk badges color by the same boundary `isAlertVetoed` actually enforces
(HIGH and CRITICAL share one color — that's the real veto line, 08 §4.2 —
not an arbitrary five-way gradient); score coloring's one real threshold
is `ALERT_MIN_SCORE`'s default (60). Both documented and unit-tested in
`lib/domain-colors.ts` — colors are semantic, not decorative, matching
the ask.

## shadcn/ui components hand-written, not CLI-generated

`pnpm dlx shadcn@latest add ...` hung indefinitely against this session's
already-documented intermittent network conditions (see 0012's retry-
tuning section). Hand-wrote Button/Badge/Card/Table/Separator matching
shadcn's actual published "new-york" style source (the style already
configured in `components.json`) rather than keep retrying a stuck
network call for well-known, stable boilerplate. Skipped Tooltip
entirely — hover tooltips don't work on touch, and "score/risk legible
at a glance on a phone" is explicitly a phone-first requirement; every
value that might have gone in a tooltip is shown inline instead
(score inputs, evidence confidence).

## Never a shortened address — verified live, not just reviewed

Contract address (detail page) and deployer address (both pages,
wherever shown) are always the full raw string with a copy button
alongside, never a `0x1234...abcd`-style truncation — confirmed against
the actual rendered HTML for the seeded test opportunity's real 42-
character address, not just read back from the source.

## isTestData rows: excluded from the list, still resolvable by ID

`/opportunities` filters `isTestData: false` — the flag exists
specifically so seeded dev fixtures don't clutter a real listing (0012).
`/opportunities/[id]` does not filter on it: a Telegram alert for a test
opportunity links directly to its detail page (confirmed live in 0012's
end-to-end send-alert test), and that link has to resolve regardless of
which flag the row carries. Verified live: toggled the seeded test
opportunity's flag to `false`, confirmed it appears correctly in the
list (all six columns), toggled it back to `true`, confirmed the list
returns to empty — the flag round-trips cleanly and the exclusion is
real, not just present in the query source.

## WEB_URL — already correct, not changed

Checked rather than assumed: `.env`'s `WEB_URL=http://localhost:3000`
already matches Next's own dev-server default port — genuinely correct
for local development right now, not a stale placeholder. No hardcoded
competing fallback exists anywhere in the codebase (grepped for it).
Left the value alone and instead strengthened
`packages/config/src/env.ts`'s comment to say plainly why it stays
`localhost` for now (apps/web has no real deployment yet — that's a
later step, and inventing a production URL before one exists would be a
fabricated URL, not a fix) and that the alert's inline button starts
appearing on its own, no code change required, the moment `WEB_URL` is
set to a real public `https` URL after deployment
(`looksLikePubliclyReachableHttpsUrl`, 0012, already gates on exactly
that).

## What does not change

The alert stage, its rules, its templates; the seed-test-opportunity/
send-alert/bot dev tooling; the database schema (no migration in this
change — every field this page shows already existed).
