import type { RiskLevel, Urgency } from "@alpharadar/types";

/**
 * Bump this whenever the formula below changes. Opportunity.scoringVersion
 * stores it per-row (08 §4.2) so a historical score is always attributable
 * to the exact rules that produced it, and can be told apart from a score
 * that would come out differently under today's rules.
 */
export const SCORING_VERSION = "2026-09-08.1";

/**
 * Every field is an explicit fact the caller already resolved — this
 * function never reads a clock, a database, or the network itself. That's
 * what makes "same inputs -> same score" a property of the function
 * itself, not something that happens to hold if you call it fast enough
 * twice in a row. `now` is passed in for exactly this reason: freshness is
 * time-dependent, but the *function* is not.
 */
export interface ScoreInputs {
  contractRiskLevel: RiskLevel;
  concentrationRiskLevel: RiskLevel;
  /** activityValue/mintValue === 0n. */
  isFree: boolean;
  detectedAt: Date;
  now: Date;
  /** Count of WalletSignal rows for this opportunity — always 0 in the MVP (docs/decisions/0005: no wallet is ever labelled "smart"). */
  smartWalletSignalCount: number;
  /** Slice 1 opportunities carry no startsAt/endsAt — always false today; kept so a future slice with real deadlines doesn't need a signature change. */
  hasDeadline: boolean;
  /** Only meaningful when hasDeadline is true. */
  msUntilDeadline?: number;
}

export interface ScoreComponents {
  legitimacy: number;
  opportunityValue: number;
  freshness: number;
  onChainSignal: number;
  smartWalletSignal: number;
  urgency: number;
}

export interface ScoreResult {
  score: number;
  components: ScoreComponents;
  urgency: Urgency;
  scoringVersion: string;
}

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Maps a RiskLevel to a fraction of a component's max points. UNKNOWN sits
 * between LOW and MEDIUM deliberately: "we don't know" is neither the best
 * nor the worst case — a confirmed-LOW-risk contract should always
 * outscore an unassessed one, and an unassessed one should always outscore
 * a confirmed MEDIUM-or-worse one.
 */
const RISK_TO_FRACTION: Record<RiskLevel, number> = {
  LOW: 1,
  UNKNOWN: 0.6,
  MEDIUM: 0.5,
  HIGH: 0.2,
  CRITICAL: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 02 §12's suggested components, unchanged in shape per 08 §4.2's fix
 * (which addresses freshness's danger via the risk veto in risk.ts's
 * isAlertVetoed, not by reweighting this function). Every weight and
 * threshold here is an initial calibration — there is no outcome data to
 * validate against yet (08 §4.2) — made adjustable, not hidden, by
 * persisting scoreInputs/scoringVersion so a re-run is always possible.
 */
export function computeScore(inputs: ScoreInputs): ScoreResult {
  const legitimacy = Math.round(25 * RISK_TO_FRACTION[inputs.contractRiskLevel]);

  const opportunityValue = inputs.isFree ? 20 : 10;

  const ageMs = Math.max(0, inputs.now.getTime() - inputs.detectedAt.getTime());
  const freshness = Math.round(20 * clamp(1 - ageMs / FRESHNESS_WINDOW_MS, 0, 1));

  const onChainSignal = Math.round(15 * RISK_TO_FRACTION[inputs.concentrationRiskLevel]);

  // Always 0 in the MVP — see the field's doc comment. Written as a real
  // computation (not a hardcoded 0) so it does the right thing the moment
  // WalletSignal rows exist, without a change here.
  const smartWalletSignal = clamp(inputs.smartWalletSignalCount * 2, 0, 10);

  let urgency: number;
  let urgencyLevel: Urgency;
  if (!inputs.hasDeadline) {
    // No deadline signal in Slice 1 — a flat, low, honest default rather
    // than a fabricated countdown.
    urgency = 3;
    urgencyLevel = "LOW";
  } else {
    const hoursLeft = (inputs.msUntilDeadline ?? 0) / (60 * 60 * 1000);
    if (hoursLeft <= 1) {
      urgency = 10;
      urgencyLevel = "CRITICAL";
    } else if (hoursLeft <= 6) {
      urgency = 8;
      urgencyLevel = "HIGH";
    } else if (hoursLeft <= 24) {
      urgency = 5;
      urgencyLevel = "MEDIUM";
    } else {
      urgency = 2;
      urgencyLevel = "LOW";
    }
  }

  const components: ScoreComponents = {
    legitimacy,
    opportunityValue,
    freshness,
    onChainSignal,
    smartWalletSignal,
    urgency,
  };

  const score = clamp(
    legitimacy + opportunityValue + freshness + onChainSignal + smartWalletSignal + urgency,
    0,
    100,
  );

  return { score, components, urgency: urgencyLevel, scoringVersion: SCORING_VERSION };
}
