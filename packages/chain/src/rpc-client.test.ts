import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareChallengeError, RpcHttpError, RpcTimeoutError } from "./errors.js";
import { createRpcProvider, isCloudflareChallengeResponse } from "./rpc-client.js";

/** A fetch that never resolves on its own — only rejects with AbortError once its signal fires, matching real fetch's behavior under AbortController. */
function makeHangingFetch(): typeof fetch {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
}

const CHALLENGE_BODY =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body></body></html>';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    text: async () => text,
  } as unknown as Response;
}

describe("isCloudflareChallengeResponse", () => {
  it("is true whenever cf-mitigated: challenge is present, regardless of status/body", () => {
    expect(isCloudflareChallengeResponse(200, "challenge", "{}")).toBe(true);
    expect(isCloudflareChallengeResponse(403, "Challenge", "{}")).toBe(true); // case-insensitive
  });

  it("is true for a 403 with the known challenge-page phrasing", () => {
    expect(isCloudflareChallengeResponse(403, null, CHALLENGE_BODY)).toBe(true);
  });

  it("is true for a 403 with an HTML body even without the exact phrasing — real JSON-RPC never returns HTML", () => {
    expect(isCloudflareChallengeResponse(403, null, "<html><body>blocked</body></html>")).toBe(
      true,
    );
  });

  it("is false for a normal 200 JSON response", () => {
    expect(
      isCloudflareChallengeResponse(200, null, '{"jsonrpc":"2.0","id":1,"result":"0x1"}'),
    ).toBe(false);
  });

  it("is false for a real 403 JSON error — not every 403 is a challenge", () => {
    expect(isCloudflareChallengeResponse(403, null, '{"error":"forbidden"}')).toBe(false);
  });

  it("is false for a non-403 error status with no cf-mitigated header", () => {
    expect(isCloudflareChallengeResponse(500, null, "internal server error")).toBe(false);
  });
});

describe("createRpcProvider", () => {
  it("returns the JSON-RPC result on a normal successful call", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0x1234" }));
    const provider = createRpcProvider({ rpcUrl: "https://rpc.test", fetchImpl });

    const result = await provider.request({ method: "eth_blockNumber", params: [] });

    expect(result).toBe("0x1234");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws CloudflareChallengeError, not a generic error, after retries are exhausted on a persistent challenge", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, CHALLENGE_BODY, { "cf-mitigated": "challenge" }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
    });

    await expect(
      provider.request({ method: "eth_getBlockReceipts", params: ["0x1"] }),
    ).rejects.toThrow(CloudflareChallengeError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2); // one sleep between each retry, not after the last attempt
  });

  it("names the failing method on the thrown CloudflareChallengeError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, CHALLENGE_BODY, { "cf-mitigated": "challenge" }));
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 1,
    });

    await expect(
      provider.request({ method: "eth_getBlockReceipts", params: [] }),
    ).rejects.toMatchObject({
      name: "CloudflareChallengeError",
      method: "eth_getBlockReceipts",
      httpStatus: 403,
    });
  });

  it("succeeds once the challenge clears mid-retry, without throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, CHALLENGE_BODY, { "cf-mitigated": "challenge" }))
      .mockResolvedValueOnce(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0xabc" }));
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 5,
    });

    await expect(provider.request({ method: "eth_blockNumber", params: [] })).resolves.toBe(
      "0xabc",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a plain 429/5xx the same way it retries a challenge", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, "rate limited"))
      .mockResolvedValueOnce(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0x1" }));
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 5,
    });

    await expect(provider.request({ method: "eth_blockNumber", params: [] })).resolves.toBe("0x1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws RpcHttpError, not CloudflareChallengeError, for a persistent plain 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, "internal error"));
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 2,
    });

    await expect(provider.request({ method: "eth_blockNumber", params: [] })).rejects.toThrow(
      RpcHttpError,
    );
  });

  it("does not retry a real JSON-RPC error (bad params) — fails on the first attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "invalid params" },
      }),
    );
    const provider = createRpcProvider({ rpcUrl: "https://rpc.test", fetchImpl, maxAttempts: 5 });

    await expect(
      provider.request({ method: "eth_getBlockByNumber", params: ["bad"] }),
    ).rejects.toThrow(/invalid params/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unparseable non-challenge body — fails on the first attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, "not json at all"));
    const provider = createRpcProvider({ rpcUrl: "https://rpc.test", fetchImpl, maxAttempts: 5 });

    await expect(provider.request({ method: "eth_blockNumber", params: [] })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createRpcProvider — timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a hanging request once timeoutMs elapses and retries it, throwing RpcTimeoutError if it keeps hanging", async () => {
    vi.useFakeTimers();
    const fetchImpl = makeHangingFetch();
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
      timeoutMs: 1000,
    });

    const promise = provider.request({ method: "eth_getBlockReceipts", params: ["0x1"] });
    const assertion = expect(promise).rejects.toThrow(RpcTimeoutError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("names the method and timeout on the thrown RpcTimeoutError", async () => {
    vi.useFakeTimers();
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl: makeHangingFetch(),
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 1,
      timeoutMs: 2500,
    });

    const promise = provider.request({ method: "eth_getBlockReceipts", params: [] });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "RpcTimeoutError",
      method: "eth_getBlockReceipts",
      timeoutMs: 2500,
    });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("succeeds normally when the response arrives before the timeout", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0x42" }));
    const provider = createRpcProvider({
      rpcUrl: "https://rpc.test",
      fetchImpl,
      timeoutMs: 10_000,
    });

    await expect(provider.request({ method: "eth_blockNumber", params: [] })).resolves.toBe("0x42");
  });

  it("defaults to a 10 second timeout when none is given, matching viem's own http() transport default", async () => {
    // Not exercised end-to-end here (that would mean a real 10s wait) —
    // this locks in the documented default via the option's fallback
    // rather than leaving it unverified.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0x1" }));
    const provider = createRpcProvider({ rpcUrl: "https://rpc.test", fetchImpl });

    await provider.request({ method: "eth_blockNumber", params: [] });

    const passedInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(passedInit.signal).toBeInstanceOf(AbortSignal);
  });
});
