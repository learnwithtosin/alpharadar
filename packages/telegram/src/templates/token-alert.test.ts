import { describe, expect, it } from "vitest";
import { renderTokenAlertMessage } from "./token-alert.js";

/**
 * Byte-for-byte against docs/spec/03-CLAUDE-BUILD-PROMPT.md's literal
 * Token template (lines 295-313).
 */
const EXPECTED_TEMPLATE = `🪙 NEW TOKEN SIGNAL

<token> / <ticker>
Chain: Robinhood Chain

CA:
<full contract address>

Score: <score>/100
Risk: <risk>
Liquidity: <value if known>
Detected: <time>

Smart-wallet signal:
<signal if available>

⚠️ NFA: Informational analysis only. No outcome or profit is guaranteed. DYOR.

👉 Open AlphaRadar`;

describe("renderTokenAlertMessage", () => {
  it("matches the spec template exactly, placeholder-for-placeholder", () => {
    const rendered = renderTokenAlertMessage({
      tokenName: "<token>",
      ticker: "<ticker>",
      contractAddress: "<full contract address>",
      score: "<score>" as unknown as number,
      risk: "<risk>" as unknown as never,
      liquidity: "<value if known>",
      detectedAt: new Date(0),
      smartWalletSignal: "<signal if available>",
    });
    // Swap in the literal "<time>" placeholder — a real Date can't render
    // that text itself, this test only needs to prove the surrounding
    // structure is exact.
    const withLiteralTime = rendered.replace(/Detected: .*/u, "Detected: <time>");

    expect(withLiteralTime).toBe(EXPECTED_TEMPLATE);
  });

  it("renders real opportunity data, full unshortened contract address", () => {
    const rendered = renderTokenAlertMessage({
      tokenName: "AlphaTest",
      ticker: "ATST",
      contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
      score: 62,
      risk: "MEDIUM",
      liquidity: null,
      detectedAt: new Date("2026-09-09T09:22:58.000Z"),
      smartWalletSignal: null,
    });

    expect(rendered).toBe(`🪙 NEW TOKEN SIGNAL

AlphaTest / ATST
Chain: Robinhood Chain

CA:
0x1234567890abcdef1234567890abcdef12345678

Score: 62/100
Risk: MEDIUM
Liquidity: Unknown
Detected: 2026-09-09 09:22 UTC

Smart-wallet signal:
None

⚠️ NFA: Informational analysis only. No outcome or profit is guaranteed. DYOR.

👉 Open AlphaRadar`);
  });

  it("never shortens the contract address", () => {
    const longAddress = "0xBeD6B57A5dB1aA23153A4C7740f21Fb76a7776F1";
    const rendered = renderTokenAlertMessage({
      tokenName: "X",
      ticker: "X",
      contractAddress: longAddress,
      score: 1,
      risk: "UNKNOWN",
      liquidity: null,
      detectedAt: new Date(),
      smartWalletSignal: null,
    });

    expect(rendered).toContain(longAddress);
    expect(rendered).not.toContain("...");
  });
});
