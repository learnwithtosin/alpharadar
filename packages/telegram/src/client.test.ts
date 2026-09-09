import { describe, expect, it, vi } from "vitest";
import { TelegramClient } from "./client.js";
import { TelegramApiError } from "./errors.js";

function telegramResponse(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("TelegramClient", () => {
  it("throws immediately at construction with an empty botToken — never silently no-ops", () => {
    expect(() => new TelegramClient({ botToken: "" })).toThrow(/botToken/);
  });

  it("posts to the correct Bot API method URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(telegramResponse({ ok: true, result: { message_id: 42 } }));
    const client = new TelegramClient({ botToken: "TEST_TOKEN", fetchImpl });

    await client.sendMessage({ chatId: "123", text: "hello" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTEST_TOKEN/sendMessage");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ chat_id: "123", text: "hello" });
  });

  it("attaches an inline keyboard row only when one is given", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(telegramResponse({ ok: true, result: { message_id: 1 } }));
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    await client.sendMessage({
      chatId: "123",
      text: "hi",
      inlineKeyboardRow: [{ text: "Open on AlphaRadar", url: "https://x.example/o/1" }],
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      reply_markup: { inline_keyboard: { text: string; url: string }[][] };
    };
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "Open on AlphaRadar", url: "https://x.example/o/1" }],
    ]);
  });

  it("returns the messageId from a successful send", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(telegramResponse({ ok: true, result: { message_id: 777 } }));
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    const result = await client.sendMessage({ chatId: "1", text: "x" });

    expect(result).toEqual({ messageId: 777 });
  });

  it("throws TelegramApiError, not a generic error, on ok:false — even with HTTP 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        telegramResponse({ ok: false, error_code: 403, description: "Forbidden: bot was blocked" }),
      );
    const client = new TelegramClient({ botToken: "T", fetchImpl, sleepImpl: vi.fn() });

    await expect(client.sendMessage({ chatId: "1", text: "x" })).rejects.toMatchObject({
      name: "TelegramApiError",
      errorCode: 403,
      description: "Forbidden: bot was blocked",
    });
  });

  it("does not retry a 403 (permanent) — fails on the first attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        telegramResponse({ ok: false, error_code: 403, description: "Forbidden" }),
      );
    const client = new TelegramClient({ botToken: "T", fetchImpl, sleepImpl: vi.fn() });

    await expect(client.sendMessage({ chatId: "1", text: "x" })).rejects.toThrow(TelegramApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429, honoring retry_after from the response body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        telegramResponse({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 1 },
        }),
      )
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 1 } }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const client = new TelegramClient({ botToken: "T", fetchImpl, sleepImpl, maxAttempts: 3 });

    const result = await client.sendMessage({ chatId: "1", text: "x" });

    expect(result).toEqual({ messageId: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(1000);
  });

  it("retries a Telegram-side 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        telegramResponse({ ok: false, error_code: 500, description: "Internal Server Error" }),
      )
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 2 } }));
    const client = new TelegramClient({
      botToken: "T",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 3,
    });

    const result = await client.sendMessage({ chatId: "1", text: "x" });

    expect(result).toEqual({ messageId: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws TelegramApiError on an unparseable response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      text: async () => "<html>Bad Gateway</html>",
    } as unknown as Response);
    const client = new TelegramClient({ botToken: "T", fetchImpl, sleepImpl: vi.fn() });

    await expect(client.sendMessage({ chatId: "1", text: "x" })).rejects.toThrow(TelegramApiError);
  });

  it("defaults to 8 attempts — a raw connection failure was previously never retried at all", async () => {
    // Before this fix, `TypeError: fetch failed` (undici's real signature
    // for ETIMEDOUT/DNS/connection-reset) fell through isRetryable as
    // false and failed on the very first attempt, regardless of
    // maxAttempts — this proves that class of error is now actually
    // retried, and enough times to matter.
    const networkError = new TypeError("fetch failed");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 1 } }));
    const client = new TelegramClient({
      botToken: "T",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    const result = await client.sendMessage({ chatId: "1", text: "x" });

    expect(result).toEqual({ messageId: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("gives up after the 8th consecutive connection failure, not before", async () => {
    const networkError = new TypeError("fetch failed");
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const client = new TelegramClient({
      botToken: "T",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.sendMessage({ chatId: "1", text: "x" })).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("does not retry an unrelated TypeError — only fetch's own 'fetch failed' signature", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("Cannot read properties of undefined"));
    const client = new TelegramClient({
      botToken: "T",
      fetchImpl,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.sendMessage({ chatId: "1", text: "x" })).rejects.toThrow(
      "Cannot read properties of undefined",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("backs off with a 1s base doubling toward a 15s cap by default", async () => {
    const networkError = new TypeError("fetch failed");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 1 } }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const client = new TelegramClient({ botToken: "T", fetchImpl, sleepImpl });

    await client.sendMessage({ chatId: "1", text: "x" });

    const delays = sleepImpl.mock.calls.map(([ms]) => ms as number);
    // 1000 * 2^(attempt-1), jittered 0.85-1.15x, capped at 15000.
    expect(delays).toHaveLength(5);
    expect(delays[0]).toBeGreaterThanOrEqual(850);
    expect(delays[0]).toBeLessThanOrEqual(1150);
    expect(delays[3]).toBeGreaterThanOrEqual(6800); // 8000 * 0.85
    expect(delays[3]).toBeLessThanOrEqual(9200); // 8000 * 1.15
  });
});

describe("TelegramClient.getUpdates", () => {
  it("passes offset/timeout/allowed_updates and maps a real message update", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      telegramResponse({
        ok: true,
        result: [
          {
            update_id: 42,
            message: {
              text: "/start",
              chat: { id: 555 },
              from: { id: 999, username: "alice" },
            },
          },
        ],
      }),
    );
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    const updates = await client.getUpdates({ offset: 43, timeoutSeconds: 30 });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      offset: 43,
      timeout: 30,
      allowed_updates: ["message"],
    });
    expect(updates).toEqual([
      {
        updateId: 42,
        message: { text: "/start", chatId: "555", fromUserId: "999", fromUsername: "alice" },
      },
    ]);
  });

  it("maps an update with no message (e.g. edited_message) to message: null, not a crash", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(telegramResponse({ ok: true, result: [{ update_id: 7 }] }));
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    const updates = await client.getUpdates({});

    expect(updates).toEqual([{ updateId: 7, message: null }]);
  });

  it("returns an empty array when Telegram's long-poll times out with nothing new", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({ ok: true, result: [] }));
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    await expect(client.getUpdates({ offset: 1, timeoutSeconds: 30 })).resolves.toEqual([]);
  });

  it("maps fromUsername to null when the sender has no username set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      telegramResponse({
        ok: true,
        result: [{ update_id: 1, message: { text: "/stop", chat: { id: 1 }, from: { id: 2 } } }],
      }),
    );
    const client = new TelegramClient({ botToken: "T", fetchImpl });

    const [update] = await client.getUpdates({});

    expect(update?.message?.fromUsername).toBeNull();
  });
});
