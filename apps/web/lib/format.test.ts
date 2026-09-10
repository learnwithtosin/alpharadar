import { describe, expect, it } from "vitest";
import {
  FRESHNESS_THRESHOLD_MS,
  formatAbsolute,
  formatAge,
  isFresh,
  SCAN_FRESHNESS_THRESHOLD_MS,
} from "./format.js";

describe("formatAge", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("shows 'just now' under a minute", () => {
    expect(formatAge(new Date("2026-09-10T11:59:30Z"), now)).toBe("just now");
  });

  it("shows minutes under an hour", () => {
    expect(formatAge(new Date("2026-09-10T11:55:00Z"), now)).toBe("5m");
  });

  it("shows hours under a day", () => {
    expect(formatAge(new Date("2026-09-10T09:00:00Z"), now)).toBe("3h");
  });

  it("shows days beyond a day", () => {
    expect(formatAge(new Date("2026-09-08T12:00:00Z"), now)).toBe("2d");
  });

  it("clamps a future date to 'just now' rather than a negative age", () => {
    expect(formatAge(new Date("2026-09-10T12:05:00Z"), now)).toBe("just now");
  });
});

describe("formatAbsolute", () => {
  it("renders UTC date and minute, explicitly labeled UTC", () => {
    expect(formatAbsolute(new Date("2026-09-09T09:22:58.123Z"))).toBe("2026-09-09 09:22 UTC");
  });
});

describe("isFresh", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("is fresh just under the threshold", () => {
    const date = new Date(now.getTime() - (FRESHNESS_THRESHOLD_MS - 1000));
    expect(isFresh(date, FRESHNESS_THRESHOLD_MS, now)).toBe(true);
  });

  it("is stale just over the threshold", () => {
    const date = new Date(now.getTime() - (FRESHNESS_THRESHOLD_MS + 1000));
    expect(isFresh(date, FRESHNESS_THRESHOLD_MS, now)).toBe(false);
  });

  it("the scan threshold is tighter than the opportunity-freshness threshold", () => {
    expect(SCAN_FRESHNESS_THRESHOLD_MS).toBeLessThan(FRESHNESS_THRESHOLD_MS);
  });
});
