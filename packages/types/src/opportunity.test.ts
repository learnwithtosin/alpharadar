import { describe, expect, it } from "vitest";
import {
  ACTION_PROFILES,
  isActionProfile,
  isOpportunityStatus,
  isOpportunityType,
  isUrgency,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  URGENCY_LEVELS,
} from "./opportunity.js";

describe("opportunity domain types", () => {
  it("has exactly the ten MVP opportunity types from 01 §4", () => {
    expect(OPPORTUNITY_TYPES).toHaveLength(10);
    expect(isOpportunityType("FREE_MINT")).toBe(true);
    expect(isOpportunityType("NOT_A_TYPE")).toBe(false);
  });

  it("has exactly the six action profiles from 01 §5", () => {
    expect(ACTION_PROFILES).toHaveLength(6);
    expect(isActionProfile("MINT")).toBe(true);
    expect(isActionProfile("BUY_NOW")).toBe(false);
  });

  it("has exactly the seven lifecycle statuses from 02 §10", () => {
    expect(OPPORTUNITY_STATUSES).toHaveLength(7);
    expect(isOpportunityStatus("DETECTED")).toBe(true);
    expect(isOpportunityStatus("DELETED")).toBe(false);
  });

  it("has exactly four urgency levels from 02 §12", () => {
    expect(URGENCY_LEVELS).toHaveLength(4);
    expect(isUrgency("CRITICAL")).toBe(true);
    expect(isUrgency("EXTREME")).toBe(false);
  });
});
