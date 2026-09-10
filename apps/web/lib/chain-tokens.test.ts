import { describe, expect, it } from "vitest";
import { chainToken } from "./chain-tokens.js";

describe("chainToken", () => {
  it("resolves the mapped label for robinhood", () => {
    expect(chainToken("robinhood")).toEqual({ label: "ROBINHOOD" });
  });

  it("falls back to the uppercased slug for an unmapped chain, not a generic label", () => {
    expect(chainToken("ethereum")).toEqual({ label: "ETHEREUM" });
  });

  it("falls back to a generic label when there is no chain at all", () => {
    expect(chainToken(null)).toEqual({ label: "UNKNOWN CHAIN" });
    expect(chainToken(undefined)).toEqual({ label: "UNKNOWN CHAIN" });
  });
});
