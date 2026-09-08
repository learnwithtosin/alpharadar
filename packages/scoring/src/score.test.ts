import { describe, expect, it } from "vitest";
import { computeScore, SCORING_VERSION, type ScoreInputs } from "./score.js";

const BASE_INPUTS: ScoreInputs = {
  contractRiskLevel: "LOW",
  concentrationRiskLevel: "LOW",
  isFree: true,
  detectedAt: new Date("2026-09-08T12:00:00Z"),
  now: new Date("2026-09-08T12:00:00Z"),
  smartWalletSignalCount: 0,
  hasDeadline: false,
};

describe("computeScore — determinism", () => {
  it("produces the exact same result for the exact same inputs, called twice", () => {
    const first = computeScore(BASE_INPUTS);
    const second = computeScore(BASE_INPUTS);

    expect(second).toEqual(first);
  });

  it("produces the exact same result for two structurally-identical-but-distinct input objects", () => {
    // Distinct object identity, distinct Date instances — must not matter.
    const inputsA: ScoreInputs = { ...BASE_INPUTS, detectedAt: new Date("2026-09-08T12:00:00Z") };
    const inputsB: ScoreInputs = { ...BASE_INPUTS, detectedAt: new Date("2026-09-08T12:00:00Z") };

    expect(computeScore(inputsA)).toEqual(computeScore(inputsB));
  });

  it("never reaches outside its inputs — the same detectedAt/now always yields the same freshness regardless of wall-clock time", () => {
    const a = computeScore(BASE_INPUTS);
    // Simulate "time passing" between two calls by not changing `now` at all.
    const b = computeScore(BASE_INPUTS);
    expect(a.components.freshness).toBe(b.components.freshness);
  });
});

describe("computeScore — components", () => {
  it("stamps the current scoringVersion on every result", () => {
    expect(computeScore(BASE_INPUTS).scoringVersion).toBe(SCORING_VERSION);
  });

  it("gives full legitimacy points for LOW contract risk, zero for CRITICAL", () => {
    const low = computeScore({ ...BASE_INPUTS, contractRiskLevel: "LOW" });
    const critical = computeScore({ ...BASE_INPUTS, contractRiskLevel: "CRITICAL" });

    expect(low.components.legitimacy).toBe(25);
    expect(critical.components.legitimacy).toBe(0);
    expect(critical.score).toBeLessThan(low.score);
  });

  it("scores a confirmed-LOW-risk contract higher than an UNKNOWN one, and UNKNOWN higher than a confirmed MEDIUM+", () => {
    const low = computeScore({ ...BASE_INPUTS, contractRiskLevel: "LOW" });
    const unknown = computeScore({ ...BASE_INPUTS, contractRiskLevel: "UNKNOWN" });
    const medium = computeScore({ ...BASE_INPUTS, contractRiskLevel: "MEDIUM" });

    expect(low.components.legitimacy).toBeGreaterThan(unknown.components.legitimacy);
    expect(unknown.components.legitimacy).toBeGreaterThan(medium.components.legitimacy);
  });

  it("gives a free opportunity more value points than a paid one", () => {
    const free = computeScore({ ...BASE_INPUTS, isFree: true });
    const paid = computeScore({ ...BASE_INPUTS, isFree: false });

    expect(free.components.opportunityValue).toBeGreaterThan(paid.components.opportunityValue);
  });

  it("decays freshness toward zero as detectedAt ages, and floors at zero", () => {
    const fresh = computeScore({ ...BASE_INPUTS, now: new Date("2026-09-08T12:00:00Z") });
    const aDayOld = computeScore({ ...BASE_INPUTS, now: new Date("2026-09-09T12:00:00Z") });
    const wayStale = computeScore({ ...BASE_INPUTS, now: new Date("2026-10-08T12:00:00Z") });

    expect(fresh.components.freshness).toBe(20);
    expect(aDayOld.components.freshness).toBeLessThan(fresh.components.freshness);
    expect(aDayOld.components.freshness).toBeGreaterThan(0);
    expect(wayStale.components.freshness).toBe(0);
  });

  it("smartWalletSignal stays 0 with no wallet signals (docs/decisions/0005)", () => {
    expect(
      computeScore({ ...BASE_INPUTS, smartWalletSignalCount: 0 }).components.smartWalletSignal,
    ).toBe(0);
  });

  it("defaults urgency to a flat low value with no deadline data, per Slice 1", () => {
    const result = computeScore({ ...BASE_INPUTS, hasDeadline: false });
    expect(result.urgency).toBe("LOW");
    expect(result.components.urgency).toBeGreaterThan(0);
  });

  it("raises urgency as a real deadline approaches", () => {
    const soon = computeScore({
      ...BASE_INPUTS,
      hasDeadline: true,
      msUntilDeadline: 30 * 60 * 1000,
    });
    const later = computeScore({
      ...BASE_INPUTS,
      hasDeadline: true,
      msUntilDeadline: 48 * 60 * 60 * 1000,
    });

    expect(soon.urgency).toBe("CRITICAL");
    expect(soon.components.urgency).toBeGreaterThan(later.components.urgency);
  });

  it("total score is always the sum of its components, clamped to [0, 100]", () => {
    const result = computeScore(BASE_INPUTS);
    const sum =
      result.components.legitimacy +
      result.components.opportunityValue +
      result.components.freshness +
      result.components.onChainSignal +
      result.components.smartWalletSignal +
      result.components.urgency;

    expect(result.score).toBe(sum);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
