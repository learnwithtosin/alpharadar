/**
 * Pure formatting helpers shared by the list and detail pages — kept
 * framework-free so they're unit-testable without rendering React.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Dense relative age for a scannable list column — "5m", "3h", "2d", never a full date. */
export function formatAge(date: Date, now: Date = new Date()): string {
  const deltaMs = Math.max(0, now.getTime() - date.getTime());
  if (deltaMs < MINUTE_MS) return "just now";
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}m`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)}h`;
  return `${Math.floor(deltaMs / DAY_MS)}d`;
}

/** Absolute UTC timestamp for the detail page, alongside the relative age — never the only time shown for a single decision-relevant record. */
export function formatAbsolute(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * "Fresh" drives the only continuous motion in the app (the pulsing
 * signal dot) — it has to mean something, not just look alive. 30
 * minutes for a detected opportunity is a handful of 5-minute cron
 * cycles, long enough that "still pulsing" reads as "this really is
 * recent," not as decoration that never turns off.
 */
export const FRESHNESS_THRESHOLD_MS = 30 * MINUTE_MS;

/**
 * The scan indicator's own freshness uses a tighter window — it's
 * judging the cron's own health, not an opportunity's age. 10 minutes
 * is ~2 cron cycles, enough slack for GitHub Actions' cron being best-
 * effort (docs/spec/09-INFRASTRUCTURE-DECISION.md) without calling a
 * merely-slightly-late run "stale."
 */
export const SCAN_FRESHNESS_THRESHOLD_MS = 10 * MINUTE_MS;

export function isFresh(date: Date, thresholdMs: number, now: Date = new Date()): boolean {
  return now.getTime() - date.getTime() < thresholdMs;
}

/**
 * "Month YYYY" for the landing page's "Live since" line — always derived
 * from a real IngestionCheckpoint.createdAt (the earliest chain's first
 * successful run), never a hardcoded string.
 */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
