/**
 * Not implemented in Slice 1 — stub only, per project instructions:
 * "Leave verify, score, analyze and alert as stubs for now."
 *
 * Intended scope (02 §12, 08 §4.2): deterministic legitimacy/value/
 * freshness/on-chain-signal/smart-wallet-signal/urgency scoring, persisted
 * to Opportunity.score/riskScore/urgency plus scoreInputs/scoringVersion
 * for reproducibility. Also owns the risk-veto rule (01 §10, 08 §4.2): an
 * opportunity is never alerted if overallRisk >= HIGH, regardless of score.
 */
export async function score(_opportunityId: string): Promise<void> {
  // Not implemented in this slice.
}
