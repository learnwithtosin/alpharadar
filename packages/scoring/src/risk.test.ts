import { describe, expect, it } from "vitest";
import {
  assessConcentrationRisk,
  assessContractRisk,
  assessDeployerRisk,
  combineOverallRisk,
  isAlertVetoed,
} from "./risk.js";

describe("assessContractRisk", () => {
  it("returns UNKNOWN when every input is unknown", () => {
    const result = assessContractRisk({
      sourceVerified: null,
      hasMintFunction: null,
      hasPauseOrBlacklistFunction: null,
      ownershipRenounced: null,
      isProxy: null,
    });

    expect(result.level).toBe("UNKNOWN");
  });

  it("returns LOW for a clean, fully-known contract", () => {
    const result = assessContractRisk({
      sourceVerified: true,
      hasMintFunction: false,
      hasPauseOrBlacklistFunction: false,
      ownershipRenounced: true,
      isProxy: false,
    });

    expect(result.level).toBe("LOW");
  });

  it("escalates for unverified + pause/blacklist + not renounced + proxy", () => {
    const result = assessContractRisk({
      sourceVerified: false,
      hasMintFunction: false,
      hasPauseOrBlacklistFunction: true,
      ownershipRenounced: false,
      isProxy: true,
    });

    // 2 (unverified) + 2 (pause/blacklist) + 1 (not renounced) + 2 (proxy) = 7
    expect(result.level).toBe("CRITICAL");
    expect(result.reasons).toContain("contract source is not verified");
    expect(result.reasons).toContain(
      "contract is an upgradeable proxy — logic can change after deployment",
    );
  });

  it("computes a risk level from partially-known inputs — not all-or-nothing", () => {
    const result = assessContractRisk({
      sourceVerified: null,
      hasMintFunction: null,
      hasPauseOrBlacklistFunction: true,
      ownershipRenounced: null,
      isProxy: null,
    });

    expect(result.level).not.toBe("UNKNOWN");
    expect(result.reasons).toContain("a pause/blacklist function selector is present in bytecode");
    expect(result.reasons).toContain("mint-function presence unknown (bytecode unavailable)");
  });
});

describe("assessConcentrationRisk", () => {
  it("is UNKNOWN when either value is missing", () => {
    expect(assessConcentrationRisk({ topHoldersValue: null, totalSupply: 1000n }).level).toBe(
      "UNKNOWN",
    );
    expect(assessConcentrationRisk({ topHoldersValue: 100n, totalSupply: null }).level).toBe(
      "UNKNOWN",
    );
  });

  it("is UNKNOWN, not a division error, when totalSupply is zero", () => {
    expect(assessConcentrationRisk({ topHoldersValue: 0n, totalSupply: 0n }).level).toBe("UNKNOWN");
  });

  it("buckets by top-10 share of supply", () => {
    expect(assessConcentrationRisk({ topHoldersValue: 100n, totalSupply: 1000n }).level).toBe(
      "LOW",
    ); // 10%
    expect(assessConcentrationRisk({ topHoldersValue: 350n, totalSupply: 1000n }).level).toBe(
      "MEDIUM",
    ); // 35%
    expect(assessConcentrationRisk({ topHoldersValue: 600n, totalSupply: 1000n }).level).toBe(
      "HIGH",
    ); // 60%
    expect(assessConcentrationRisk({ topHoldersValue: 800n, totalSupply: 1000n }).level).toBe(
      "CRITICAL",
    ); // 80%
  });
});

describe("assessDeployerRisk", () => {
  it("is UNKNOWN when both inputs are unknown", () => {
    expect(assessDeployerRisk({ deployerAgeMs: null, priorDeploymentCount: null }).level).toBe(
      "UNKNOWN",
    );
  });

  it("flags a brand-new deployer address", () => {
    const result = assessDeployerRisk({
      deployerAgeMs: 30 * 60 * 1000,
      priorDeploymentCount: null,
    });
    expect(result.level).not.toBe("LOW");
    expect(result.reasons).toContain("deployer address became active less than an hour ago");
  });

  it("flags a serial deployer", () => {
    const result = assessDeployerRisk({ deployerAgeMs: null, priorDeploymentCount: 8 });
    expect(result.level).not.toBe("LOW");
    expect(result.reasons.some((r) => r.includes("serial-deployer"))).toBe(true);
  });

  it("is LOW for an established deployer with no other observed deployments", () => {
    const result = assessDeployerRisk({
      deployerAgeMs: 365 * 24 * 60 * 60 * 1000,
      priorDeploymentCount: 0,
    });
    expect(result.level).toBe("LOW");
  });
});

describe("combineOverallRisk", () => {
  it("is UNKNOWN when every dimension is UNKNOWN", () => {
    expect(combineOverallRisk(["UNKNOWN", "UNKNOWN", "UNKNOWN"])).toBe("UNKNOWN");
  });

  it("ignores UNKNOWN dimensions and takes the worst of the known ones", () => {
    expect(combineOverallRisk(["LOW", "UNKNOWN", "HIGH"])).toBe("HIGH");
    expect(combineOverallRisk(["LOW", "MEDIUM"])).toBe("MEDIUM");
    expect(combineOverallRisk(["CRITICAL", "LOW", "LOW"])).toBe("CRITICAL");
  });
});

describe("isAlertVetoed — 08 §4.2", () => {
  it("vetoes HIGH and CRITICAL", () => {
    expect(isAlertVetoed("HIGH")).toBe(true);
    expect(isAlertVetoed("CRITICAL")).toBe(true);
  });

  it("does not veto LOW, MEDIUM, or UNKNOWN", () => {
    expect(isAlertVetoed("LOW")).toBe(false);
    expect(isAlertVetoed("MEDIUM")).toBe(false);
    expect(isAlertVetoed("UNKNOWN")).toBe(false);
  });
});
