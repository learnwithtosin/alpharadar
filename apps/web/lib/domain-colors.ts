import type { RiskLevel, Urgency } from "@alpharadar/types";

/**
 * Semantic color, not decorative — the whole point is score/risk legible
 * at a glance. HIGH/CRITICAL risk map to the same danger color: that's
 * exactly the veto boundary in packages/scoring's isAlertVetoed (08 §4.2,
 * HIGH or above blocks an alert), so the color boundary matches the real
 * decision boundary, not an arbitrary five-way gradient. LOW uses
 * `signal` — AlphaRadar's own accent (0014) — rather than a generic
 * emerald: "this dimension is fine" is exactly the rare, meaningful
 * moment that token is reserved for.
 */
export function riskBadgeClassName(risk: RiskLevel): string {
  switch (risk) {
    case "LOW":
      return "border-signal/45 bg-signal/10 text-signal";
    case "MEDIUM":
      return "border-warn/45 bg-warn/10 text-warn";
    case "HIGH":
    case "CRITICAL":
      return "border-destructive/45 bg-destructive/10 text-destructive";
    case "UNKNOWN":
    default:
      return "border-unknown/40 bg-unknown/5 text-unknown";
  }
}

export function urgencyBadgeClassName(urgency: Urgency): string {
  switch (urgency) {
    case "CRITICAL":
      return "border-destructive/45 bg-destructive/10 text-destructive";
    case "HIGH":
      return "border-warn/45 bg-warn/10 text-warn";
    case "MEDIUM":
    case "LOW":
    default:
      return "border-border bg-transparent text-muted-foreground";
  }
}

/**
 * Score has no product-defined tiers the way risk has a veto boundary —
 * this is purely a legibility aid (signal/amber/red at a glance), tied to
 * ALERT_MIN_SCORE's default (60) as the one real threshold that exists
 * (packages/config/src/env.ts), not an invented scale.
 */
export type ScoreTier = "good" | "warn" | "bad";

export function scoreTier(score: number): ScoreTier {
  if (score >= 60) return "good";
  if (score >= 40) return "warn";
  return "bad";
}

const SCORE_TIER_TEXT: Record<ScoreTier, string> = {
  good: "text-signal",
  warn: "text-warn",
  bad: "text-destructive",
};

const SCORE_TIER_GLOW: Record<ScoreTier, string> = {
  good: "bg-signal",
  warn: "bg-warn",
  bad: "bg-destructive",
};

export function scoreClassName(score: number): string {
  return SCORE_TIER_TEXT[scoreTier(score)];
}

export function scoreGlowClassName(score: number): string {
  return SCORE_TIER_GLOW[scoreTier(score)];
}
