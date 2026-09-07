import { describe, expect, it } from "vitest";
import { isAtLeastRisk, isRiskLevel, RISK_LEVELS } from "./risk.js";

describe("risk domain types", () => {
  it("includes UNKNOWN as a first-class level, per 01 §8", () => {
    expect(RISK_LEVELS).toContain("UNKNOWN");
    expect(isRiskLevel("UNKNOWN")).toBe(true);
  });

  it("orders risk levels for the alert-veto rule (01 §10, 08 §4.2)", () => {
    expect(isAtLeastRisk("HIGH", "HIGH")).toBe(true);
    expect(isAtLeastRisk("CRITICAL", "HIGH")).toBe(true);
    expect(isAtLeastRisk("MEDIUM", "HIGH")).toBe(false);
    expect(isAtLeastRisk("LOW", "LOW")).toBe(true);
  });
});
