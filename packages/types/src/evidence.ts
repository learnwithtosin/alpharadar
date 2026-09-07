/**
 * Mirrors the EvidenceType enum in packages/database/prisma/schema.prisma.
 *
 * 01-PROJECT-CONSTITUTION.md §8 — exact match, do not add values. Not named
 * in 03-CLAUDE-BUILD-PROMPT.md's shared-types list, but it is used by the
 * Evidence table and is exactly the kind of literal that list exists to
 * avoid duplicating across apps, so it lives here too.
 */
export const EVIDENCE_TYPES = ["FACT", "INFERENCE", "AI_INTERPRETATION", "UNKNOWN"] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export function isEvidenceType(value: string): value is EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(value);
}
