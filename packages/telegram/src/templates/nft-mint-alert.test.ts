import { describe, expect, it } from "vitest";
import { deriveNftMintAlertReasons, renderNftMintAlertMessage } from "./nft-mint-alert.js";

/**
 * Byte-for-byte against docs/spec/03-CLAUDE-BUILD-PROMPT.md's literal NFT
 * template (lines 277-291) — copied here as a fixture, not re-typed from
 * memory, so a future spec edit is caught by a diff against this file.
 */
const EXPECTED_TEMPLATE = `🎨 NEW FREE MINT

Project: <name>
Chain: Robinhood Chain
Mint: FREE
Status: LIVE
Score: <score>/100
Risk: <risk>
Urgency: <urgency>

Why it matters:
• <reason>
• <reason>

👉 Open on AlphaRadar`;

describe("renderNftMintAlertMessage", () => {
  it("matches the spec template exactly, placeholder-for-placeholder", () => {
    const rendered = renderNftMintAlertMessage({
      projectName: "<name>",
      score: "<score>" as unknown as number,
      risk: "<risk>" as unknown as never,
      urgency: "<urgency>" as unknown as never,
      reasons: ["<reason>", "<reason>"],
    });

    expect(rendered).toBe(EXPECTED_TEMPLATE);
  });

  it("renders real opportunity data into the exact same structure", () => {
    const rendered = renderNftMintAlertMessage({
      projectName: "CookLauncherToken",
      score: 78,
      risk: "LOW",
      urgency: "MEDIUM",
      reasons: ["Free to participate — no cost to mint", "Contract risk assessed as LOW"],
    });

    expect(rendered).toBe(`🎨 NEW FREE MINT

Project: CookLauncherToken
Chain: Robinhood Chain
Mint: FREE
Status: LIVE
Score: 78/100
Risk: LOW
Urgency: MEDIUM

Why it matters:
• Free to participate — no cost to mint
• Contract risk assessed as LOW

👉 Open on AlphaRadar`);
  });
});

describe("deriveNftMintAlertReasons", () => {
  it("prioritizes free-mint and low contract risk when both are true", () => {
    const reasons = deriveNftMintAlertReasons({
      isFree: true,
      contractRisk: "LOW",
      concentrationRisk: "UNKNOWN",
      score: 78,
      ageMs: 10 * 60 * 60 * 1000,
    });

    expect(reasons).toEqual([
      "Free to participate — no cost to mint",
      "Contract risk assessed as LOW",
    ]);
  });

  it("falls back to score and detection-method facts when nothing else qualifies", () => {
    const reasons = deriveNftMintAlertReasons({
      isFree: false,
      contractRisk: "UNKNOWN",
      concentrationRisk: "UNKNOWN",
      score: 55,
      ageMs: 10 * 60 * 60 * 1000,
    });

    expect(reasons).toEqual([
      "AlphaRadar score: 55/100",
      "Detected via on-chain contract-creation monitoring, not a third-party listing",
    ]);
  });

  it("includes a recency reason when detected within the last hour", () => {
    const reasons = deriveNftMintAlertReasons({
      isFree: false,
      contractRisk: "UNKNOWN",
      concentrationRisk: "UNKNOWN",
      score: 55,
      ageMs: 5 * 60 * 1000,
    });

    expect(reasons).toContain("Detected within the last hour — early signal");
  });

  it("always returns exactly two reasons, never fabricated, never empty", () => {
    const reasons = deriveNftMintAlertReasons({
      isFree: false,
      contractRisk: "HIGH",
      concentrationRisk: "HIGH",
      score: 10,
      ageMs: 999_999_999,
    });

    expect(reasons).toHaveLength(2);
    expect(reasons.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
  });
});
