import { RISK_LEVEL_ORDER, type RiskLevel } from "@alpharadar/types";

/**
 * Every input here is `T | null` where null means "we don't know," never
 * "known to be false/zero." 01-PROJECT-CONSTITUTION.md §8: unknown
 * information stays unknown rather than being fabricated — a caller that
 * couldn't fetch a signal must pass null, not a guessed default. When every
 * input to a dimension is null, that dimension's result is RiskLevel
 * "UNKNOWN", not a silently-computed LOW.
 */

export interface RiskAssessmentResult {
  level: RiskLevel;
  reasons: string[];
}

function bucket(
  points: number,
  thresholds: { medium: number; high: number; critical: number },
): RiskLevel {
  if (points >= thresholds.critical) return "CRITICAL";
  if (points >= thresholds.high) return "HIGH";
  if (points >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// contractRisk — 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §4.1: "bytecode
// analysis: mint function present, blacklist/pause function present,
// ownership renounced, proxy/upgradeable, source verified via Blockscout."
// ---------------------------------------------------------------------------

export interface ContractRiskInput {
  /** From ChainAdapter.getContractVerification; null if the check failed/was unreachable. */
  sourceVerified: boolean | null;
  /** Bytecode contains a selector for a common mint(...) function; null if bytecode was unavailable. */
  hasMintFunction: boolean | null;
  /** Bytecode contains a selector for pause()/blacklist(...)-style functions; null if bytecode was unavailable. */
  hasPauseOrBlacklistFunction: boolean | null;
  /** owner() (OpenZeppelin Ownable) returned the zero address; null if owner() reverted — not Ownable, a normal outcome, not missing data by itself. */
  ownershipRenounced: boolean | null;
  /** The EIP-1967 implementation slot is non-zero; null only if the storage read itself failed. */
  isProxy: boolean | null;
}

/**
 * Point weights are an initial calibration, not validated against real
 * outcome data — 08 §4.2 flags there is none on day one. scoreInputs
 * persistence (see score.ts) is what makes these adjustable later without
 * losing history.
 */
export function assessContractRisk(input: ContractRiskInput): RiskAssessmentResult {
  const reasons: string[] = [];
  let points = 0;
  let known = false;

  if (input.sourceVerified === null) {
    reasons.push("source verification status unknown");
  } else {
    known = true;
    if (!input.sourceVerified) {
      points += 2;
      reasons.push("contract source is not verified");
    }
  }

  if (input.hasMintFunction === null) {
    reasons.push("mint-function presence unknown (bytecode unavailable)");
  } else {
    known = true;
    if (input.hasMintFunction) {
      points += 1;
      reasons.push("a mint function selector is present in bytecode");
    }
  }

  if (input.hasPauseOrBlacklistFunction === null) {
    reasons.push("pause/blacklist-function presence unknown (bytecode unavailable)");
  } else {
    known = true;
    if (input.hasPauseOrBlacklistFunction) {
      points += 2;
      reasons.push("a pause/blacklist function selector is present in bytecode");
    }
  }

  if (input.ownershipRenounced === null) {
    reasons.push("ownership-renouncement status unknown (not Ownable, or the check failed)");
  } else {
    known = true;
    if (!input.ownershipRenounced) {
      points += 1;
      reasons.push("ownership has not been renounced");
    }
  }

  if (input.isProxy === null) {
    reasons.push("proxy status unknown (storage read failed)");
  } else {
    known = true;
    if (input.isProxy) {
      points += 2;
      reasons.push("contract is an upgradeable proxy — logic can change after deployment");
    }
  }

  if (!known) {
    return { level: "UNKNOWN", reasons };
  }

  return { level: bucket(points, { medium: 1, high: 3, critical: 5 }), reasons };
}

// ---------------------------------------------------------------------------
// concentrationRisk — 08 §4.1: "top-10 holder share from indexer."
// ---------------------------------------------------------------------------

export interface ConcentrationRiskInput {
  /** Sum of the top-10 holders' balances. */
  topHoldersValue: bigint | null;
  totalSupply: bigint | null;
}

export function assessConcentrationRisk(input: ConcentrationRiskInput): RiskAssessmentResult {
  if (input.topHoldersValue === null || input.totalSupply === null || input.totalSupply === 0n) {
    return {
      level: "UNKNOWN",
      reasons: ["holder concentration unknown (holders or total supply unavailable)"],
    };
  }

  // Basis points to stay in integer bigint math, then a float only for display.
  const shareBasisPoints = Number((input.topHoldersValue * 10_000n) / input.totalSupply);
  const sharePercent = shareBasisPoints / 100;
  const reasons = [`top-10 holders control ${sharePercent.toFixed(1)}% of supply`];

  if (sharePercent >= 70) return { level: "CRITICAL", reasons };
  if (sharePercent >= 50) return { level: "HIGH", reasons };
  if (sharePercent >= 30) return { level: "MEDIUM", reasons };
  return { level: "LOW", reasons };
}

// ---------------------------------------------------------------------------
// deployerRisk — 08 §4.1: "deployer address age, prior deployments, prior
// rugs among them." Prior rugs is not built (would need an off-chain scam
// registry, out of MVP scope) — age and prior-deployment count only.
// ---------------------------------------------------------------------------

export interface DeployerRiskInput {
  /** Milliseconds since the deployer's earliest activity we could observe; null if unknown. */
  deployerAgeMs: number | null;
  /** Other contracts this pipeline has observed the same deployer creating; null only if the DB read itself failed. */
  priorDeploymentCount: number | null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export function assessDeployerRisk(input: DeployerRiskInput): RiskAssessmentResult {
  const reasons: string[] = [];
  let points = 0;
  let known = false;

  if (input.deployerAgeMs === null) {
    reasons.push("deployer address age unknown");
  } else {
    known = true;
    if (input.deployerAgeMs < ONE_HOUR_MS) {
      points += 2;
      reasons.push("deployer address became active less than an hour ago");
    } else if (input.deployerAgeMs < ONE_DAY_MS) {
      points += 1;
      reasons.push("deployer address became active less than a day ago");
    }
  }

  if (input.priorDeploymentCount === null) {
    reasons.push("prior deployment count unknown");
  } else {
    known = true;
    if (input.priorDeploymentCount >= 5) {
      points += 2;
      reasons.push(
        `deployer has ${input.priorDeploymentCount} other observed deployments — serial-deployer pattern`,
      );
    } else if (input.priorDeploymentCount >= 2) {
      points += 1;
      reasons.push(`deployer has ${input.priorDeploymentCount} other observed deployments`);
    }
  }

  if (!known) {
    return { level: "UNKNOWN", reasons };
  }

  return { level: bucket(points, { medium: 1, high: 3, critical: 4 }), reasons };
}

// ---------------------------------------------------------------------------
// overallRisk — the worst of whatever dimensions are actually known.
// liquidityRisk/socialRisk/linkRisk are always UNKNOWN in the MVP
// (docs/decisions/0006) and are expected to be passed in as "UNKNOWN" —
// they don't need special-casing here, UNKNOWN dimensions simply never win.
// ---------------------------------------------------------------------------

export function combineOverallRisk(dimensions: RiskLevel[]): RiskLevel {
  const known = dimensions.filter((d): d is Exclude<RiskLevel, "UNKNOWN"> => d !== "UNKNOWN");
  if (known.length === 0) return "UNKNOWN";
  return known.reduce((worst, level) =>
    RISK_LEVEL_ORDER[level] > RISK_LEVEL_ORDER[worst] ? level : worst,
  );
}

/**
 * 08 §4.2's risk veto: an opportunity is never alerted if overallRisk is
 * HIGH or above, regardless of score. UNKNOWN never vetoes — the whole
 * point of keeping it a distinct value (01 §8) is that "we don't know" is
 * not the same claim as "this is risky."
 */
export function isAlertVetoed(overallRisk: RiskLevel): boolean {
  return overallRisk !== "UNKNOWN" && RISK_LEVEL_ORDER[overallRisk] >= RISK_LEVEL_ORDER.HIGH;
}
