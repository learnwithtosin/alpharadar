import { describe, expect, it, vi } from "vitest";
import { BlockscoutHttpError } from "./errors.js";
import { parseRetryAfterMs, withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result on the first success without sleeping", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(
      fn,
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
      () => true,
      sleepImpl,
    );

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retries a retryable error and eventually succeeds", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");

    const result = await withRetry(
      fn,
      { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 1000 },
      () => true,
      sleepImpl,
    );

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error the predicate marks non-retryable", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const error = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 1000 }, () => false, sleepImpl),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const error = new Error("still failing");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 1000 }, () => true, sleepImpl),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit retryAfterMs over the computed backoff", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new BlockscoutHttpError("rate limited", 429, 5000))
      .mockResolvedValue("ok");

    await withRetry(
      fn,
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 60_000 },
      () => true,
      sleepImpl,
    );

    expect(sleepImpl).toHaveBeenCalledWith(5000);
  });

  it("caps the delay at maxDelayMs even when retryAfterMs is larger", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new BlockscoutHttpError("rate limited", 429, 999_999))
      .mockResolvedValue("ok");

    await withRetry(
      fn,
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 2000 },
      () => true,
      sleepImpl,
    );

    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });
});

describe("parseRetryAfterMs", () => {
  it("returns undefined for a null header", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it("parses a seconds value", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });

  it("parses an HTTP-date value", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const result = parseRetryAfterMs(future);
    expect(result).toBeGreaterThan(8000);
    expect(result).toBeLessThanOrEqual(10_000);
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseRetryAfterMs("not-a-value")).toBeUndefined();
  });
});
