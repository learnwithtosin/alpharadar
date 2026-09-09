/**
 * Telegram's Bot API returns HTTP 200 with `{ok: false, error_code,
 * description}` for most failures — confirmed against Telegram's own Bot
 * API docs, not assumed — so a non-2xx HTTP status alone isn't the signal
 * to check. errorCode is Telegram's own `error_code` (e.g. 400 bad
 * request, 403 bot blocked by user, 429 rate limited).
 */
export class TelegramApiError extends Error {
  readonly errorCode: number;
  readonly description: string;
  /** Only set for a 429 — Telegram's `parameters.retry_after`, in ms. */
  readonly retryAfterMs?: number;

  constructor(message: string, errorCode: number, description: string, retryAfterMs?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfterMs = retryAfterMs;
  }
}
