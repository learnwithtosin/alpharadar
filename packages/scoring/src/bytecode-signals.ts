/**
 * Coarse bytecode-selector scanning for contractRisk (08 §4.1). Checks
 * whether a function's 4-byte selector appears anywhere in the deployed
 * runtime bytecode — Solidity's compiler emits the selector as a literal
 * PUSH4 operand in the dispatcher, so its presence is a real (if
 * imprecise) signal that the function exists. This is a coarse heuristic,
 * not a decompiler: it can produce a false positive if the same 4 bytes
 * appear as unrelated constant data, and it says nothing about who can
 * call the function or whether it's actually reachable. Good enough to
 * flag "this contract *can* do X," not proof that it *will*.
 *
 * Selectors below were computed from their signatures via viem's
 * `toFunctionSelector` (keccak256-based), not typed from memory — each is
 * reproducible from the signature comment beside it.
 */
import type { Hex } from "viem";

/** mint(address,uint256) */
const MINT_ADDRESS_UINT256 = "40c10f19";
/** mint(uint256) */
const MINT_UINT256 = "a0712d68";
/** mint(address) */
const MINT_ADDRESS = "6a627842";
/** mintTo(address,uint256) */
const MINT_TO_ADDRESS_UINT256 = "449a52f8";

export const MINT_FUNCTION_SELECTORS: readonly string[] = [
  MINT_ADDRESS_UINT256,
  MINT_UINT256,
  MINT_ADDRESS,
  MINT_TO_ADDRESS_UINT256,
];

/** pause() */
const PAUSE = "8456cb59";
/** unpause() */
const UNPAUSE = "3f4ba83a";
/** blacklist(address) */
const BLACKLIST = "f9f92be4";
/** addBlacklist(address) */
const ADD_BLACKLIST = "9cfe42da";
/** setBlacklist(address,bool) */
const SET_BLACKLIST = "153b0d1e";
/** blocklist(address) */
const BLOCKLIST = "e5c7160b";

export const PAUSE_OR_BLACKLIST_FUNCTION_SELECTORS: readonly string[] = [
  PAUSE,
  UNPAUSE,
  BLACKLIST,
  ADD_BLACKLIST,
  SET_BLACKLIST,
  BLOCKLIST,
];

/**
 * True if any selector in `selectors` (8 lowercase hex chars, no "0x")
 * appears anywhere in `bytecode`. Returns null, not false, for empty/absent
 * bytecode — that's "we couldn't check," not "checked and found none."
 */
export function bytecodeContainsAnySelector(
  bytecode: Hex | null,
  selectors: readonly string[],
): boolean | null {
  if (bytecode === null || bytecode === "0x" || bytecode.length <= 2) {
    return null;
  }
  const lower = bytecode.toLowerCase();
  return selectors.some((selector) => lower.includes(selector));
}
