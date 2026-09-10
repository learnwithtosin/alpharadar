import { describe, expect, it } from "vitest";
import {
  riskBadgeClassName,
  scoreClassName,
  scoreGlowClassName,
  scoreTier,
  urgencyBadgeClassName,
} from "./domain-colors.js";

describe("riskBadgeClassName", () => {
  it("gives HIGH and CRITICAL the same color — they share the alert-veto boundary", () => {
    expect(riskBadgeClassName("HIGH")).toBe(riskBadgeClassName("CRITICAL"));
  });

  it("gives LOW the signal (AlphaRadar accent) color, not a generic emerald", () => {
    expect(riskBadgeClassName("LOW")).toContain("signal");
  });

  it("gives LOW a distinct color from HIGH/CRITICAL", () => {
    expect(riskBadgeClassName("LOW")).not.toBe(riskBadgeClassName("HIGH"));
  });

  it("gives UNKNOWN a neutral color distinct from LOW and HIGH", () => {
    const unknown = riskBadgeClassName("UNKNOWN");
    expect(unknown).not.toBe(riskBadgeClassName("LOW"));
    expect(unknown).not.toBe(riskBadgeClassName("HIGH"));
    expect(unknown).toContain("unknown");
  });
});

describe("urgencyBadgeClassName", () => {
  it("gives CRITICAL and HIGH distinct, non-neutral colors", () => {
    const critical = urgencyBadgeClassName("CRITICAL");
    const high = urgencyBadgeClassName("HIGH");
    expect(critical).not.toBe(high);
    expect(critical).toContain("destructive");
    expect(high).toContain("warn");
  });

  it("never uses the signal accent for urgency — that token is reserved for score/risk positives", () => {
    (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).forEach((u) => {
      expect(urgencyBadgeClassName(u)).not.toContain("signal");
    });
  });
});

describe("scoreTier / scoreClassName / scoreGlowClassName", () => {
  it("is 'good' (signal) at and above the ALERT_MIN_SCORE default (60)", () => {
    expect(scoreTier(60)).toBe("good");
    expect(scoreTier(100)).toBe("good");
    expect(scoreClassName(60)).toContain("signal");
    expect(scoreGlowClassName(60)).toContain("signal");
  });

  it("is 'warn' in the middle band", () => {
    expect(scoreTier(50)).toBe("warn");
    expect(scoreClassName(50)).toContain("warn");
  });

  it("is 'bad' below 40", () => {
    expect(scoreTier(0)).toBe("bad");
    expect(scoreTier(39)).toBe("bad");
    expect(scoreClassName(0)).toContain("destructive");
  });
});
