/**
 * Chain identity as data, not a theme — docs/decisions/0014-web-visual-
 * identity.md. The design system's accent (`--signal`) never varies by
 * chain; where a chain needs to be visually distinguishable (a badge on
 * a list row, a label on the detail page), it comes from this map, keyed
 * by the same chain slug ChainAdapter/Prisma already use
 * (ROBINHOOD_CHAIN_SLUG = "robinhood"). Adding a second chain means
 * adding a row here — nothing about layout or the color system changes.
 *
 * Robinhood's own entry is deliberately colorless (the same neutral
 * treatment as the default) — giving it a color risks the exact brand-
 * affinity problem 0014 moved the whole app's accent away from, just
 * relocated to one badge instead of everywhere.
 */
export interface ChainToken {
  label: string;
}

const CHAIN_TOKENS: Record<string, ChainToken> = {
  robinhood: { label: "ROBINHOOD" },
};

const DEFAULT_CHAIN_TOKEN: ChainToken = { label: "UNKNOWN CHAIN" };

export function chainToken(chainSlug: string | null | undefined): ChainToken {
  if (!chainSlug) return DEFAULT_CHAIN_TOKEN;
  return CHAIN_TOKENS[chainSlug] ?? { label: chainSlug.toUpperCase() };
}
