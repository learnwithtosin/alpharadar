/**
 * Not implemented in Slice 1 — stub only, per project instructions:
 * "Leave verify, score, analyze and alert as stubs for now."
 *
 * Intended scope (02 §14, 08 §4.4): render and send the Telegram NFT/token
 * templates, respecting per-user thresholds, the hourly alert cap, dedupe
 * window, and off-by-default-except-CRITICAL delivery — and record
 * Alert.suppressedReason when a threshold or the risk veto (score.ts)
 * blocks delivery, rather than silently dropping it.
 */
export async function alert(_opportunityId: string): Promise<void> {
  // Not implemented in this slice.
}
