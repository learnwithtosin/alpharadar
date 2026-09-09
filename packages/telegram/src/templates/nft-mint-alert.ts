import type { RiskLevel, Urgency } from "@alpharadar/types";

/**
 * docs/spec/03-CLAUDE-BUILD-PROMPT.md's "Telegram templates" — NFT, exact
 * text. Every line outside the `<...>` placeholders is fixed spec text,
 * reproduced verbatim (see render-nft-mint-alert.test.ts, which asserts
 * this byte-for-byte against the spec). Never shorten the contract in the
 * *token* template — see that file — this one has none to shorten.
 */
export interface NftMintAlertInput {
  projectName: string;
  score: number;
  risk: RiskLevel;
  urgency: Urgency;
  /** Exactly two bullets — the template shows exactly two "• <reason>" lines. */
  reasons: readonly [string, string];
}

export function renderNftMintAlertMessage(input: NftMintAlertInput): string {
  return [
    "🎨 NEW FREE MINT",
    "",
    `Project: ${input.projectName}`,
    "Chain: Robinhood Chain",
    "Mint: FREE",
    "Status: LIVE",
    `Score: ${input.score}/100`,
    `Risk: ${input.risk}`,
    `Urgency: ${input.urgency}`,
    "",
    "Why it matters:",
    `• ${input.reasons[0]}`,
    `• ${input.reasons[1]}`,
    "",
    "👉 Open on AlphaRadar",
  ].join("\n");
}

export interface NftMintAlertReasonInputs {
  isFree: boolean;
  contractRisk: RiskLevel;
  concentrationRisk: RiskLevel;
  score: number;
  /** Milliseconds since detection — drives the "detected recently" reason. */
  ageMs: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Every candidate reason states a fact this pipeline actually computed —
 * 01 §8: never fabricate a reason to fill the template. Picks the two
 * highest-priority facts that are true; the last two candidates are always
 * true (a score always exists by the time alert() runs, and ageMs is
 * always >= 0), so this always has at least two to return.
 */
export function deriveNftMintAlertReasons(input: NftMintAlertReasonInputs): [string, string] {
  const candidates: string[] = [];

  if (input.isFree) {
    candidates.push("Free to participate — no cost to mint");
  }
  if (input.contractRisk === "LOW") {
    candidates.push("Contract risk assessed as LOW");
  }
  if (input.concentrationRisk === "LOW") {
    candidates.push("Low holder concentration");
  }
  if (input.ageMs < ONE_HOUR_MS) {
    candidates.push("Detected within the last hour — early signal");
  }
  candidates.push(`AlphaRadar score: ${input.score}/100`);
  candidates.push("Detected via on-chain contract-creation monitoring, not a third-party listing");

  return [candidates[0] as string, candidates[1] as string];
}
