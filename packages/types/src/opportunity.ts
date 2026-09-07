/**
 * Mirrors the OpportunityType, ActionProfile, OpportunityStatus and Urgency
 * enums in packages/database/prisma/schema.prisma. Prisma's schema DSL
 * cannot import these, so the two declarations must be kept in sync by hand.
 */

// 01-PROJECT-CONSTITUTION.md §4 — do not add types without a concrete MVP requirement.
export const OPPORTUNITY_TYPES = [
  "NFT_MINT",
  "NFT_WHITELIST",
  "FREE_MINT",
  "RAFFLE",
  "TOKEN_LAUNCH",
  "MEMECOIN",
  "UTILITY_TOKEN",
  "AIRDROP",
  "TESTNET",
  "DEFI",
] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export function isOpportunityType(value: string): value is OpportunityType {
  return (OPPORTUNITY_TYPES as readonly string[]).includes(value);
}

// 01-PROJECT-CONSTITUTION.md §5 — action profile is independent of opportunity type.
export const ACTION_PROFILES = [
  "MINT",
  "QUALIFY",
  "TRADE_RESEARCH",
  "CHECK_ELIGIBILITY",
  "PARTICIPATE",
  "RESEARCH",
] as const;

export type ActionProfile = (typeof ACTION_PROFILES)[number];

export function isActionProfile(value: string): value is ActionProfile {
  return (ACTION_PROFILES as readonly string[]).includes(value);
}

// 02-MVP-TECHNICAL-SPECIFICATION.md §10 — explicit lifecycle state.
export const OPPORTUNITY_STATUSES = [
  "DETECTED",
  "VERIFYING",
  "ACTIVE",
  "UPCOMING",
  "EXPIRED",
  "REJECTED",
  "COMPLETED",
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export function isOpportunityStatus(value: string): value is OpportunityStatus {
  return (OPPORTUNITY_STATUSES as readonly string[]).includes(value);
}

// 02-MVP-TECHNICAL-SPECIFICATION.md §12 — suggested urgency levels.
export const URGENCY_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type Urgency = (typeof URGENCY_LEVELS)[number];

export function isUrgency(value: string): value is Urgency {
  return (URGENCY_LEVELS as readonly string[]).includes(value);
}
