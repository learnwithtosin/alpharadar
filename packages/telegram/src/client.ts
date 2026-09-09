import { TelegramApiError } from "./errors.js";
import { sleep, withRetry } from "./retry.js";

export interface TelegramClientOptions {
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface InlineKeyboardButton {
  text: string;
  url: string;
}

export interface SendMessageParams {
  chatId: string;
  text: string;
  /** A single row of buttons, e.g. the "Open on AlphaRadar" link — a native Telegram UI element, not part of the message text. */
  inlineKeyboardRow?: InlineKeyboardButton[];
}

export interface SendMessageResult {
  messageId: number;
}

export interface TelegramUpdate {
  updateId: number;
  /** null for an update this bot doesn't care about (edited_message, callback_query, ...) — only plain messages carry a command. */
  message: {
    text: string;
    chatId: string;
    fromUserId: string;
    fromUsername: string | null;
  } | null;
}

interface RawTelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number | string };
    from?: { id: number | string; username?: string };
  };
}

function toTelegramUpdate(raw: RawTelegramUpdate): TelegramUpdate {
  if (!raw.message || raw.message.text === undefined || !raw.message.from) {
    return { updateId: raw.update_id, message: null };
  }
  return {
    updateId: raw.update_id,
    message: {
      text: raw.message.text,
      chatId: String(raw.message.chat.id),
      fromUserId: String(raw.message.from.id),
      fromUsername: raw.message.from.username ?? null,
    },
  };
}

interface RawTelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Thin wrapper over the Telegram Bot API (https://api.telegram.org/bot
 * <token>/<method>) — raw fetch, no SDK, matching this monorepo's existing
 * clients (packages/chain's BlockscoutClient, rpc-client.ts). Telegram
 * returns HTTP 200 with `{ok: false, error_code, description}` for most
 * failures (confirmed against Telegram's own Bot API documentation), so
 * every response body has to be inspected — a 2xx HTTP status alone
 * doesn't mean success.
 */
export class TelegramClient {
  private readonly botToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: TelegramClientOptions) {
    if (!options.botToken) {
      throw new Error(
        "TelegramClient requires a non-empty botToken — TELEGRAM_BOT_TOKEN is not configured.",
      );
    }
    this.botToken = options.botToken;
    this.baseUrl = options.baseUrl ?? "https://api.telegram.org";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? sleep;
    // 8 attempts, 1s base doubling to a 15s cap, sums to ~60s of backoff
    // across the 7 retries (1+2+4+8+15+15+15) before jitter — confirmed
    // live (docs/decisions/0012) that Telegram connectivity from at least
    // one real deployment target is intermittent (repeated ETIMEDOUT,
    // always recovering within a few minutes), and a dropped alert is
    // this product's one job, not a background task that can shrug off a
    // failed attempt. Previous defaults (3 attempts, ~1.5s total) were
    // sized for ordinary API errors, not sustained network flakiness.
    this.maxAttempts = options.maxAttempts ?? 8;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/bot${this.botToken}/${method}`;

    return withRetry(
      async () => {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const bodyText = await safeReadText(res);
        let body: RawTelegramResponse<T>;
        try {
          body = JSON.parse(bodyText) as RawTelegramResponse<T>;
        } catch {
          throw new TelegramApiError(
            `Telegram ${method} returned an unparseable response: ${bodyText}`,
            res.status,
            bodyText,
          );
        }

        if (!body.ok) {
          const retryAfterMs = body.parameters?.retry_after
            ? body.parameters.retry_after * 1000
            : undefined;
          throw new TelegramApiError(
            `Telegram ${method} failed: ${body.error_code} ${body.description}`,
            body.error_code ?? res.status,
            body.description ?? "unknown error",
            retryAfterMs,
          );
        }

        return body.result as T;
      },
      { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs, maxDelayMs: this.maxDelayMs },
      // Rate limiting (429) and Telegram-side 5xx are transient — a 400
      // (malformed request) or 403 (bot blocked/kicked) will never
      // succeed on retry (03's error-handling rule). Also retry a raw
      // connection failure (fetch itself throwing, not a Telegram
      // response) — confirmed live this is undici's exact signature for
      // ETIMEDOUT/DNS/connection-reset failures (`TypeError: fetch
      // failed`, with the real cause on `.cause`), and it's exactly the
      // failure mode observed repeatedly against api.telegram.org (see
      // docs/decisions/0012). Before this, a network-level failure fell
      // through this predicate as false and was never retried at all —
      // maxAttempts/backoff above didn't matter because this class of
      // error never reached them.
      (error) =>
        (error instanceof TypeError && error.message === "fetch failed") ||
        (error instanceof TelegramApiError && (error.errorCode === 429 || error.errorCode >= 500)),
      this.sleepImpl,
    );
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const result = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: params.chatId,
      text: params.text,
      ...(params.inlineKeyboardRow
        ? {
            reply_markup: {
              inline_keyboard: [
                params.inlineKeyboardRow.map((button) => ({ text: button.text, url: button.url })),
              ],
            },
          }
        : {}),
    });
    return { messageId: result.message_id };
  }

  /** Confirms the token is valid and reports the bot's own @username — so an operator can be told exactly who to message. */
  async getMe(): Promise<{ id: number; username: string | null }> {
    const result = await this.call<{ id: number; username?: string }>("getMe", {});
    return { id: result.id, username: result.username ?? null };
  }

  /**
   * Long-polling, not a webhook — a webhook needs a publicly reachable
   * HTTPS URL, which this project's dev/interactive bot process doesn't
   * have. `timeoutSeconds` tells Telegram's server to hold the request
   * open for up to that long waiting for a new update before responding
   * with an empty array, rather than this client polling tightly.
   * `offset` must be the last-seen `updateId + 1` — Telegram redelivers
   * every update at or after `offset` on every call otherwise.
   */
  async getUpdates(params: {
    offset?: number;
    timeoutSeconds?: number;
  }): Promise<TelegramUpdate[]> {
    const raw = await this.call<RawTelegramUpdate[]>("getUpdates", {
      offset: params.offset,
      timeout: params.timeoutSeconds ?? 0,
      allowed_updates: ["message"],
    });
    return raw.map(toTelegramUpdate);
  }
}
