import type { RiskLevel } from "@alpharadar/types";
import { isAlertVetoed } from "@alpharadar/scoring";

export interface GateResult {
  suppressed: boolean;
  /** Set only when suppressed=true — pairs with Alert.suppressedReason (schema comment). */
  reason: string | null;
}

function pass(): GateResult {
  return { suppressed: false, reason: null };
}

/**
 * Rules that apply once per opportunity, before any per-user fan-out — 08
 * §4.4's risk veto and dedupe window are properties of the *content*, not
 * of any one recipient: if this project/actionProfile already alerted
 * recently, or the risk veto fires, nothing about a given user's own
 * preferences changes that. `alreadyAlertedRecently` and `overallRisk` are
 * computed by the caller (DB reads); this function only combines already-
 * known facts into one decision, so it's deterministic and testable
 * without a database.
 */
export interface GlobalGateInput {
  score: number | null;
  overallRisk: RiskLevel;
  /** True if any Alert for this project+actionProfile was SENT within the dedupe window (08 §4.4). */
  alreadyAlertedRecently: boolean;
  minScore: number;
}

export function evaluateGlobalGate(input: GlobalGateInput): GateResult {
  if (input.score === null) {
    return { suppressed: true, reason: "opportunity has not been scored yet" };
  }
  if (isAlertVetoed(input.overallRisk)) {
    return {
      suppressed: true,
      reason: `risk veto: overallRisk is ${input.overallRisk} (08 §4.2)`,
    };
  }
  if (input.alreadyAlertedRecently) {
    return {
      suppressed: true,
      reason:
        "duplicate: this project already alerted for the same action profile within the dedupe window (08 §4.4)",
    };
  }
  if (input.score < input.minScore) {
    return {
      suppressed: true,
      reason: `score ${input.score} is below the minimum alert score (${input.minScore})`,
    };
  }
  return pass();
}

/**
 * Rules scoped to one recipient — 08 §4.4's per-user hourly cap, plus
 * whether this user is even reachable (an active, enabled Telegram link).
 * `hourlyAlertCountForUser` is computed by the caller (a DB count over the
 * last hour); this function just decides against it.
 */
export interface UserGateInput {
  score: number;
  telegramActive: boolean;
  telegramEnabled: boolean;
  userMinimumScore: number;
  hourlyAlertCountForUser: number;
  maxPerUserPerHour: number;
}

export function evaluateUserGate(input: UserGateInput): GateResult {
  if (!input.telegramActive) {
    return {
      suppressed: true,
      reason: "user's Telegram account is not active (stopped via /stop)",
    };
  }
  if (!input.telegramEnabled) {
    return { suppressed: true, reason: "user has disabled Telegram alerts in settings" };
  }
  if (input.score < input.userMinimumScore) {
    return {
      suppressed: true,
      reason: `score ${input.score} is below this user's minimum score (${input.userMinimumScore})`,
    };
  }
  if (input.hourlyAlertCountForUser >= input.maxPerUserPerHour) {
    return {
      suppressed: true,
      reason: `user has reached the hourly alert cap (${input.maxPerUserPerHour}/hour, 08 §4.4)`,
    };
  }
  return pass();
}
