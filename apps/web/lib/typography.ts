/**
 * The app's type scale for content below "hero" scale. Large display
 * numbers/headings (the landing hero's headline, the detail page's
 * score) are sized to the moment at their own call sites — this file
 * doesn't tokenize those. Everything that reads as a bracketed label or
 * a sentence of body copy uses one of these two values instead of an ad
 * hoc arbitrary size, so raising legibility sitewide is a one-place
 * change, not a hunt through every component. Sibling to lib/spacing.ts.
 */

/**
 * Bracketed section labels (BracketHeader), stat-tile labels, and other
 * small field labels describing the content next to them. Previously as
 * small as 0.62-0.65rem (10-10.5px) in several places — comfortably
 * larger now, while staying visually distinct from body copy.
 */
export const LABEL_TEXT = "text-[13px]";

/**
 * Card copy, disclosures, and other prose meant to be read at normal
 * viewing distance — not a label, not dense tabular/monospace data
 * (addresses, JSON, source URLs keep their own established monospace
 * density; see docs/decisions/0015). Previously 0.75-0.875rem
 * (12-14px), "straining to read at normal viewing distance" per direct
 * feedback; raised to a comfortable reading size.
 */
export const BODY_TEXT = "text-[15px] leading-relaxed";
