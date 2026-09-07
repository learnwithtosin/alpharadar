import { describe, expect, it, vi } from "vitest";
import { BlockscoutClient, DEFAULT_USER_AGENT } from "./blockscout-client.js";
import { BlockscoutHttpError } from "./errors.js";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("BlockscoutClient", () => {
  it("sends a browser User-Agent — required by the live Cloudflare gate", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await client.get("/v2/stats");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(DEFAULT_USER_AGENT);
  });

  it("builds the URL by concatenation, not URL(path, base) — which would drop /api", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await client.get("/v2/tokens/0xabc");

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://x.example/api/v2/tokens/0xabc");
  });

  it("attaches query params, skipping null/undefined values", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await client.get("/v2/addresses/0xabc/transactions", {
      query: { block_number: 100, index: 2, items_count: undefined },
    });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(
      "https://x.example/api/v2/addresses/0xabc/transactions?block_number=100&index=2",
    );
  });

  it("returns the parsed JSON body on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { symbol: "LINK" }));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await expect(client.get("/v2/tokens/0xabc")).resolves.toEqual({ symbol: "LINK" });
  });

  it("returns null on 404 when okOn404 is set — confirmed live: unverified contract lookup", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { message: "Not found" }));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await expect(client.get("/v2/smart-contracts/0xabc", { okOn404: true })).resolves.toBeNull();
  });

  it("throws on 404 when okOn404 is not set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { message: "Not found" }));
    const client = new BlockscoutClient({ baseUrl: "https://x.example/api", fetchImpl });

    await expect(client.get("/v2/tokens/0xabc")).rejects.toThrow(BlockscoutHttpError);
  });

  it("does not retry a 422 (malformed address) — fails on the first attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        errors: [{ title: "Invalid value", detail: "Invalid format" }],
      }),
    );
    const client = new BlockscoutClient({
      baseUrl: "https://x.example/api",
      fetchImpl,
      maxAttempts: 5,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.get("/v2/smart-contracts/not-an-address")).rejects.toThrow(
      BlockscoutHttpError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 and succeeds — confirmed live: intermittent plain 500s under load", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, "Internal server error"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new BlockscoutClient({
      baseUrl: "https://x.example/api",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.get("/v2/stats")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 honoring Retry-After, then succeeds", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new BlockscoutClient({
      baseUrl: "https://x.example/api",
      fetchImpl,
      sleepImpl,
    });

    await expect(client.get("/v2/stats")).resolves.toEqual({ ok: true });
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("gives up after maxAttempts on persistent 500s", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, "Internal server error"));
    const client = new BlockscoutClient({
      baseUrl: "https://x.example/api",
      fetchImpl,
      maxAttempts: 3,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.get("/v2/stats")).rejects.toThrow(BlockscoutHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
