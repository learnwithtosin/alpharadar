import type { RiskLevel } from "@alpharadar/types";

/**
 * docs/spec/03-CLAUDE-BUILD-PROMPT.md's "Telegram templates" — Token,
 * exact text. "Never shorten the contract in the actual alert" (03) —
 * `contractAddress` is rendered in full, never truncated or ellipsized.
 * `liquidity`/`smartWalletSignal` are `string | null`: null renders the
 * template's own "if known"/"if available" honestly as unknown/none
 * rather than guessing (01 §8) — liquidityRisk is always UNKNOWN and no
 * WalletSignal is ever produced in this MVP (docs/decisions/0006, 0005).
 */
export interface TokenAlertInput {
  tokenName: string;
  ticker: string;
  contractAddress: string;
  score: number;
  risk: RiskLevel;
  liquidity: string | null;
  detectedAt: Date;
  smartWalletSignal: string | null;
}

/** UTC, minute precision — stable and unambiguous across timezones for a shared alert channel. */
function formatDetectedAt(date: Date): string {
  const iso = date.toISOString(); // 2026-09-09T09:22:58.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function renderTokenAlertMessage(input: TokenAlertInput): string {
  return [
    "🪙 NEW TOKEN SIGNAL",
    "",
    `${input.tokenName} / ${input.ticker}`,
    "Chain: Robinhood Chain",
    "",
    "CA:",
    input.contractAddress,
    "",
    `Score: ${input.score}/100`,
    `Risk: ${input.risk}`,
    `Liquidity: ${input.liquidity ?? "Unknown"}`,
    `Detected: ${formatDetectedAt(input.detectedAt)}`,
    "",
    "Smart-wallet signal:",
    input.smartWalletSignal ?? "None",
    "",
    "⚠️ NFA: Informational analysis only. No outcome or profit is guaranteed. DYOR.",
    "",
    "👉 Open AlphaRadar",
  ].join("\n");
}
