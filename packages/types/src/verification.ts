/**
 * Mirrors the VerificationStatus and SourceType enums in
 * packages/database/prisma/schema.prisma.
 */

// 01-PROJECT-CONSTITUTION.md §14 — external links are untrusted until verified.
export const VERIFICATION_STATUSES = [
  "OFFICIAL",
  "LIKELY_OFFICIAL",
  "UNVERIFIED",
  "SUSPICIOUS",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export function isVerificationStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

// 02-MVP-TECHNICAL-SPECIFICATION.md §11 — what gets cross-checked, plus
// MANUAL_ENTRY for the admin-entry endpoint (docs/decisions/0003).
export const SOURCE_TYPES = [
  "WEBSITE",
  "TWITTER",
  "DISCORD",
  "TELEGRAM",
  "DOCUMENTATION",
  "BLOCKCHAIN_EXPLORER",
  "ON_CHAIN",
  "MANUAL_ENTRY",
  "OTHER",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}
