import { describe, expect, it } from "vitest";
import { evaluateGlobalGate, evaluateUserGate } from "./alert-rules.js";

describe("evaluateGlobalGate", () => {
  const BASE = {
    score: 75,
    overallRisk: "LOW" as const,
    alreadyAlertedRecently: false,
    minScore: 60,
  };

  it("passes when nothing suppresses it", () => {
    expect(evaluateGlobalGate(BASE)).toEqual({ suppressed: false, reason: null });
  });

  it("suppresses an unscored opportunity", () => {
    const result = evaluateGlobalGate({ ...BASE, score: null });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("not been scored");
  });

  it("suppresses HIGH risk via the veto, even at a perfect score", () => {
    const result = evaluateGlobalGate({ ...BASE, score: 100, overallRisk: "HIGH" });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("risk veto");
  });

  it("suppresses CRITICAL risk via the veto", () => {
    const result = evaluateGlobalGate({ ...BASE, overallRisk: "CRITICAL" });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("risk veto");
  });

  it("does not veto UNKNOWN risk — 'we don't know' is not 'this is risky'", () => {
    const result = evaluateGlobalGate({ ...BASE, overallRisk: "UNKNOWN" });
    expect(result.suppressed).toBe(false);
  });

  it("does not veto MEDIUM risk — veto only fires at HIGH or above", () => {
    const result = evaluateGlobalGate({ ...BASE, overallRisk: "MEDIUM" });
    expect(result.suppressed).toBe(false);
  });

  it("suppresses a duplicate within the dedupe window", () => {
    const result = evaluateGlobalGate({ ...BASE, alreadyAlertedRecently: true });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("duplicate");
  });

  it("suppresses a score below the global minimum", () => {
    const result = evaluateGlobalGate({ ...BASE, score: 59 });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("below the minimum alert score");
  });

  it("passes a score exactly at the global minimum", () => {
    const result = evaluateGlobalGate({ ...BASE, score: 60 });
    expect(result.suppressed).toBe(false);
  });
});

describe("evaluateUserGate", () => {
  const BASE = {
    score: 75,
    telegramActive: true,
    telegramEnabled: true,
    userMinimumScore: 60,
    hourlyAlertCountForUser: 0,
    maxPerUserPerHour: 6,
  };

  it("passes when nothing suppresses it", () => {
    expect(evaluateUserGate(BASE)).toEqual({ suppressed: false, reason: null });
  });

  it("suppresses an inactive (stopped) Telegram account", () => {
    const result = evaluateUserGate({ ...BASE, telegramActive: false });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("not active");
  });

  it("suppresses when the user has disabled Telegram alerts", () => {
    const result = evaluateUserGate({ ...BASE, telegramEnabled: false });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("disabled Telegram alerts");
  });

  it("checks telegramActive before telegramEnabled, reporting the more fundamental reason", () => {
    const result = evaluateUserGate({ ...BASE, telegramActive: false, telegramEnabled: false });
    expect(result.reason).toContain("not active");
  });

  it("suppresses a score below this user's own minimum, even above the global floor", () => {
    const result = evaluateUserGate({ ...BASE, score: 65, userMinimumScore: 70 });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("below this user's minimum");
  });

  it("suppresses once the hourly cap is reached", () => {
    const result = evaluateUserGate({ ...BASE, hourlyAlertCountForUser: 6, maxPerUserPerHour: 6 });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain("hourly alert cap");
  });

  it("passes just under the hourly cap", () => {
    const result = evaluateUserGate({ ...BASE, hourlyAlertCountForUser: 5, maxPerUserPerHour: 6 });
    expect(result.suppressed).toBe(false);
  });
});
