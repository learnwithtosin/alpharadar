import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  bytecodeContainsAnySelector,
  MINT_FUNCTION_SELECTORS,
  PAUSE_OR_BLACKLIST_FUNCTION_SELECTORS,
} from "./bytecode-signals.js";

describe("bytecodeContainsAnySelector", () => {
  it("returns null (not false) for missing bytecode — 'unchecked', not 'checked and clean'", () => {
    expect(bytecodeContainsAnySelector(null, MINT_FUNCTION_SELECTORS)).toBeNull();
    expect(bytecodeContainsAnySelector("0x" as Hex, MINT_FUNCTION_SELECTORS)).toBeNull();
  });

  it("finds a selector embedded in real-shaped dispatcher bytecode", () => {
    // Solidity's function dispatcher pushes the selector as a PUSH4 literal
    // (opcode 0x63) before comparing — this is what that looks like around
    // mint(address,uint256)'s selector.
    const bytecode =
      "0x6080604052348015600e575f80fd5b50600436106030575f3560e01c806340c10f1914603457" as Hex;

    expect(bytecodeContainsAnySelector(bytecode, MINT_FUNCTION_SELECTORS)).toBe(true);
  });

  it("returns false when none of the given selectors appear", () => {
    const bytecode =
      "0x6080604052348015600e575f80fd5b50600436106030575f3560e01c80638da5cb5b14603457" as Hex; // owner()

    expect(bytecodeContainsAnySelector(bytecode, MINT_FUNCTION_SELECTORS)).toBe(false);
    expect(bytecodeContainsAnySelector(bytecode, PAUSE_OR_BLACKLIST_FUNCTION_SELECTORS)).toBe(
      false,
    );
  });

  it("matches case-insensitively", () => {
    const bytecode = "0x40C10F19" as Hex;
    expect(bytecodeContainsAnySelector(bytecode, MINT_FUNCTION_SELECTORS)).toBe(true);
  });
});
