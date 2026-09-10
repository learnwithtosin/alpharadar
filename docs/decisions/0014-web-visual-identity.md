# 0014 — Web visual identity: accent color is AlphaRadar's, not any chain's

Status: Accepted and implemented — `--signal` (CSS variable, `apps/web/app/globals.css`), `CHAIN_TOKENS` (`apps/web/lib/chain-tokens.ts`), live across `/`, `/opportunities`, `/opportunities/[id]`
Date: 2026-09-10
Related: docs/decisions/0013-web-opportunities-pages.md (the pages this identity applies to), docs/spec/09-INFRASTRUCTURE-DECISION.md (the `ChainAdapter` boundary this mirrors)

## The accent is not Robinhood's green

The first visual-direction pass used one saturated green for the app's
structural accent (brackets, rules, the "good" score/risk color) that,
on reflection, sat close to Robinhood's own brand green — their stock
app's well-known `~#00C805`, roughly hue 125° (a warm, "grass/money"
green). AlphaRadar's accent is now a deliberately different green:
teal-shifted, roughly hue 168° (dark `hsl(168 85% 58%)`, light
`hsl(168 75% 28%)`) — a cooler, more electric/synthetic color, ~43° of
hue away from Robinhood's warmer lime. Chosen to read as "signal," not
"stock ticker."

Two reasons, both real, not just aesthetic preference:

1. **Trademark/brand-confusion risk.** This product is named after
   Robinhood Chain and surfaces memecoins deployed on it. Matching the
   chain's own brand color on top of that naming proximity invites a
   reasonable question about whether AlphaRadar is affiliated with or
   endorsed by Robinhood — a question worth not inviting when it's easy
   not to.
2. **Multi-chain architecture.** 01 §17 already frames Robinhood Chain
   as "the only chain in the MVP," not the only chain ever. If the
   product's own accent color happened to *be* one chain's brand color,
   every future chain the product adds would force a choice: keep an
   accent that now looks like it belongs to a competitor's chain, or
   redesign. Picking an accent with no chain affiliation at all avoids
   that fork entirely — the identity is AlphaRadar's regardless of how
   many chains it watches.

## Chain identity is a data attribute, not a theme

Where a chain does need to be visually distinguishable — a badge on a
list row, a label on the detail page — that comes from a small lookup
table (`CHAIN_TOKENS` in the preview; will live in `apps/web/lib/` when
implemented), keyed by chain slug, with an explicit neutral default for
any chain not yet in the map:

```js
var CHAIN_TOKENS = {
  robinhood: { label: "ROBINHOOD" } // no color — see below
};
var DEFAULT_CHAIN_TOKEN = { label: "UNKNOWN CHAIN" };
```

Robinhood's own entry is deliberately colorless (a neutral outlined
badge, same treatment as the default) — not because it's temporary, but
because giving it any color at all would risk exactly the brand-affinity
problem above, now scoped down to "just the badge" instead of "the whole
app," which is still a problem worth not having. Adding a second chain
later means adding one row to this map; nothing about layout, the color
system, or any component changes. This is the same boundary
`ChainAdapter` already draws between chain-specific mechanics and
chain-agnostic pipeline logic (09 §5) — applied here to the UI: domain
components (score display, risk grid, panels) never branch on chain,
they read one small per-chain token where a chain badge is genuinely
needed and nowhere else.

## What does not change

The rest of 0013's direction — dark canonical / light as a genuinely
separate "blueprint" design, radar/signal-intelligence framing (score as
signal strength, risk as threat classification, age as time-since-
contact), bracketed section headers, the risk grid with UNKNOWN visibly
dimmed rather than hidden, unshortened addresses everywhere, phone-first
layout. This decision is scoped to the accent color and how chain
identity is represented — not a reversal of the direction itself.

## Implementation note

`--signal` is a separate CSS variable from shadcn's own `--accent`
(`apps/web/tailwind.config.ts`'s `accent` token, untouched) — the two
were kept distinct on purpose so AlphaRadar's accent can stay rare
(reserved for the score, the CTA, and LOW-risk) without fighting shadcn's
own hover/highlight color for the same name. `--signal` is genuinely
constant across both themes' *hue* (~168°) — only lightness/saturation
shift between dark (`hsl(168 85% 58%)`) and light (`hsl(168 75% 28%)`)
to hold contrast, matching 0013's "deepened, not lightened" rule for
positive-state color. `chainToken()` is now live in three places:
`ChainBadge` (list rows, the detail page's meta line), and the landing
page's "WATCHING" section, which lists every chain with an
`IngestionCheckpoint` row through the same lookup — a second chain
appearing there requires no changes beyond adding its row to
`CHAIN_TOKENS`.
