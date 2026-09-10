import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Structural smoke tests against prisma/schema.prisma's own source text —
 * parsed directly, not through the generated client's DMMF. Confirmed
 * live: with `engineType = "client"` (docs/decisions/0023 — dropping the
 * native query engine for @prisma/adapter-pg), the generated client no
 * longer exposes `Prisma.dmmf` at runtime at all — a deliberate part of
 * that architecture's leaner footprint, not a bug to work around. Parsing
 * the schema text directly is arguably more appropriate anyway: these
 * tests exist to catch drift in *our* schema against spec requirements,
 * not to test whatever shape Prisma's generated output happens to take.
 *
 * Deliberately minimal — just enough of the schema DSL (models, fields,
 * `?` nullability, `@unique`, `@default(...)`, `@@unique([...])`) for the
 * assertions below, verified against the real schema.prisma before being
 * wired in here (every value below was cross-checked against a real
 * parse run, not assumed correct from reading the regexes).
 */
const schemaText = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf-8");

interface ParsedField {
  name: string;
  isRequired: boolean;
  isUnique: boolean;
  default?: string;
}

interface ParsedModel {
  name: string;
  fields: ParsedField[];
  uniqueIndexes: { fields: string[] }[];
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function parseModels(text: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const modelRegex = /^model\s+(\w+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(text))) {
    const name = match[1] ?? "";
    const body = match[2] ?? "";
    const fields: ParsedField[] = [];
    const uniqueIndexes: { fields: string[] }[] = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const uniqueIndexMatch = line.match(/^@@unique\(\[([^\]]+)\]/);
      if (uniqueIndexMatch) {
        const rawFields = uniqueIndexMatch[1] ?? "";
        uniqueIndexes.push({ fields: rawFields.split(",").map((s) => s.trim()) });
        continue;
      }
      if (line.startsWith("@@")) continue;
      const fieldMatch = line.match(/^(\w+)\s+([\w[\]]+)(\?)?/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1] ?? "";
      const optional = fieldMatch[3];
      const defaultMatch = line.match(/@default\((\w+)\)/);
      fields.push({
        name: fieldName,
        isRequired: optional !== "?",
        isUnique: /@unique\b/.test(line),
        default: defaultMatch?.[1],
      });
    }
    models.push({ name, fields, uniqueIndexes });
  }
  return models;
}

function parseEnums(text: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const enumRegex = /^enum\s+(\w+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = enumRegex.exec(text))) {
    const name = match[1] ?? "";
    const body = match[2] ?? "";
    const values = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    enums.set(name, values);
  }
  return enums;
}

const cleanedSchema = stripComments(schemaText);
const models = parseModels(cleanedSchema);
const enums = parseEnums(cleanedSchema);

function model(name: string): ParsedModel {
  const found = models.find((m) => m.name === name);
  if (!found) throw new Error(`Model ${name} not found in schema.prisma`);
  return found;
}

function fieldNames(modelName: string): string[] {
  return model(modelName).fields.map((f) => f.name);
}

function enumValues(name: string): string[] {
  const found = enums.get(name);
  if (!found) throw new Error(`Enum ${name} not found in schema.prisma`);
  return found;
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

  it("Opportunity has nullable chain and contractAddress (apps/pipeline dedup key, 08 §4.5)", () => {
    const fields = model("Opportunity").fields;
    const chain = fields.find((f) => f.name === "chain");
    const contractAddress = fields.find((f) => f.name === "contractAddress");
    expect(chain?.isRequired).toBe(false);
    expect(contractAddress?.isRequired).toBe(false);
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

  it("the Opportunity open-status dedup key (08 §4.5) is a real partial unique index in the migration", () => {
    // Prisma's DMMF has no concept of this constraint — it's a hand-written
    // WHERE-clause index Prisma's schema DSL can't express (see the field
    // comment in schema.prisma). This guards against someone regenerating
    // migrations and silently losing it.
    const migrationPath = join(
      __dirname,
      "../prisma/migrations/20260907162851_opportunity_contract_dedup/migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "Opportunity_open_dedup_key" ON "Opportunity"\("chain", "contractAddress", "type", "actionProfile"\)/,
    );
    expect(sql).toMatch(/WHERE[\s\S]*"status" NOT IN \('COMPLETED', 'EXPIRED'\)/);
  });
});
