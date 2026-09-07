/**
 * Mirrors the RiskLevel enum in packages/database/prisma/schema.prisma.
 *
 * UNKNOWN is a first-class value, not a fallback: per
 * 01-PROJECT-CONSTITUTION.md §8, unknown information stays unknown rather
 * than being fabricated. docs/decisions/0006-risk-and-token-page-unknowns.md
 * records that socialRisk and liquidityRisk are UNKNOWN for the entire MVP.
 *
 * Ordering below is significant for the risk-veto rule (01 §10; 08 §4.2):
 * an opportunity is never alerted if overallRisk >= HIGH, regardless of
 * score. RISK_LEVEL_ORDER gives that comparison a single source of truth.
 */
export const RISK_LEVELS = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

/** Ordinal rank for comparisons such as `overallRisk >= HIGH`. UNKNOWN is not ordered. */
export const RISK_LEVEL_ORDER: Record<Exclude<RiskLevel, "UNKNOWN">, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function isAtLeastRisk(
  level: Exclude<RiskLevel, "UNKNOWN">,
  threshold: Exclude<RiskLevel, "UNKNOWN">,
): boolean {
  return RISK_LEVEL_ORDER[level] >= RISK_LEVEL_ORDER[threshold];
}
