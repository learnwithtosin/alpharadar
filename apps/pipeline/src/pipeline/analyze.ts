/**
 * Not implemented in Slice 1 — stub only, per project instructions:
 * "Leave verify, score, analyze and alert as stubs for now."
 *
 * Intended scope (02 §13, 08 §4.3): AI analysis of the structured evidence
 * bundle, gated behind AI_ENABLED and AI_MIN_SCORE_TO_ANALYZE (both already
 * off/high by default per 09 §9 — AI is "interface built, flag off" for
 * this slice, per docs/decisions/0007), schema-validated before
 * persistence to AIAnalysis.
 */
export async function analyze(_opportunityId: string): Promise<void> {
  // Not implemented in this slice.
}
