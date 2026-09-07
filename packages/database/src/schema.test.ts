import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

/**
 * Structural smoke tests against the generated Prisma DMMF. These run
 * without a live database — they only check the shape `prisma generate`
 * produced from prisma/schema.prisma matches 02 §7 plus the 09 §7 / 0004
 * additions, so a schema regression is caught at test time instead of only
 * when someone runs a migration.
 */
const models = Prisma.dmmf.datamodel.models;
const enums = Prisma.dmmf.datamodel.enums;

function model(name: string) {
  const found = models.find((m) => m.name === name);
  if (!found) throw new Error(`Model ${name} not found in generated client`);
  return found;
}

function fieldNames(modelName: string): string[] {
  return model(modelName).fields.map((f) => f.name);
}

function enumValues(name: string): string[] {
  const found = enums.find((e) => e.name === name);
  if (!found) throw new Error(`Enum ${name} not found in generated client`);
  return found.values.map((v) => v.name);
}

describe("schema — 02 §7 table coverage", () => {
  it("has every table from 02 §7 plus IngestionCheckpoint from 09 §7", () => {
    const expected = [
      "User",
      "UserSettings",
      "TelegramAccount",
      "Wallet",
      "Project",
      "ProjectSocial",
      "Contract",
      "Opportunity",
      "OpportunityRequirement",
      "OpportunityEvent",
      "Source",
      "Evidence",
      "RiskAssessment",
      "AIAnalysis",
      "WalletActivity",
      "WalletSignal",
      "Alert",
      "Participation",
      "IngestionCheckpoint",
    ];
    const actual = models.map((m) => m.name).sort();
    expect(actual).toEqual([...expected].sort());
  });
});

describe("schema — 01 §4 opportunity types (exact match, no additions)", () => {
  it("has exactly the ten MVP opportunity types", () => {
    expect(enumValues("OpportunityType").sort()).toEqual(
      [
        "NFT_MINT",
        "NFT_WHITELIST",
        "FREE_MINT",
        "RAFFLE",
        "TOKEN_LAUNCH",
        "MEMECOIN",
        "UTILITY_TOKEN",
        "AIRDROP",
        "TESTNET",
        "DEFI",
      ].sort(),
    );
  });
});

describe("schema — 01 §8 evidence discipline (exact match)", () => {
  it("EvidenceType has exactly FACT / INFERENCE / AI_INTERPRETATION / UNKNOWN", () => {
    expect(enumValues("EvidenceType").sort()).toEqual(
      ["FACT", "INFERENCE", "AI_INTERPRETATION", "UNKNOWN"].sort(),
    );
  });
});

describe("schema — 0006 risk dimensions default to UNKNOWN", () => {
  it("RiskLevel includes UNKNOWN as a first-class value", () => {
    expect(enumValues("RiskLevel")).toContain("UNKNOWN");
  });

  it("every RiskAssessment risk field defaults to UNKNOWN", () => {
    const riskFields = [
      "overallRisk",
      "contractRisk",
      "liquidityRisk",
      "socialRisk",
      "linkRisk",
      "deployerRisk",
      "concentrationRisk",
    ];
    const fields = model("RiskAssessment").fields;
    for (const name of riskFields) {
      const field = fields.find((f) => f.name === name);
      expect(field, `${name} should exist on RiskAssessment`).toBeDefined();
      expect(field?.default).toEqual("UNKNOWN");
    }
  });
});

describe("schema — 09 §7 additive columns", () => {
  it("Opportunity has scoreInputs and scoringVersion", () => {
    expect(fieldNames("Opportunity")).toEqual(
      expect.arrayContaining(["scoreInputs", "scoringVersion"]),
    );
  });

  it("Alert has suppressedReason, targetChatId, and nullable userId", () => {
    const fields = model("Alert").fields;
    expect(fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["suppressedReason", "targetChatId", "userId"]),
    );
    const userIdField = fields.find((f) => f.name === "userId");
    expect(userIdField?.isRequired).toBe(false);
  });

  it("User has nullable email and passwordHash (docs/decisions/0004)", () => {
    const fields = model("User").fields;
    const email = fields.find((f) => f.name === "email");
    const passwordHash = fields.find((f) => f.name === "passwordHash");
    expect(email?.isRequired).toBe(false);
    expect(passwordHash?.isRequired).toBe(false);
  });
});

describe("schema — 09 §7 IngestionCheckpoint", () => {
  it("has chain (unique), lastBlockNumber, lastRunAt, lastRunStatus, lastRunError", () => {
    expect(fieldNames("IngestionCheckpoint")).toEqual(
      expect.arrayContaining([
        "chain",
        "lastBlockNumber",
        "lastRunAt",
        "lastRunStatus",
        "lastRunError",
      ]),
    );
    const chainField = model("IngestionCheckpoint").fields.find((f) => f.name === "chain");
    expect(chainField?.isUnique).toBe(true);
  });
});

describe("schema — duplicate prevention (02 §7)", () => {
  it("Contract has a unique constraint on (chain, address)", () => {
    const uniqueIndexes = model("Contract").uniqueIndexes;
    const hasChainAddressUnique = uniqueIndexes.some(
      (idx) => [...idx.fields].sort().join(",") === ["chain", "address"].sort().join(","),
    );
    expect(hasChainAddressUnique).toBe(true);
  });
});
