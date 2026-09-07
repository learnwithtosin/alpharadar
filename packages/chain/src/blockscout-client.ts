import { BlockscoutHttpError } from "./errors.js";
import { parseRetryAfterMs, sleep, withRetry } from "./retry.js";

/**
 * Confirmed necessary against the live Robinhood Chain explorer: the
 * default User-Agent sent by curl/Node's fetch gets a 403 Cloudflare
 * JS-challenge page instead of JSON. A realistic browser UA passes cleanly.
 * Every request through this client must send one.
 */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export interface BlockscoutClientOptions {
  /** e.g. https://robinhoodchain.blockscout.com/api (ROBINHOOD_EXPLORER_API_URL) */
  baseUrl: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface BlockscoutGetOptions {
  query?: Record<string, string | number | undefined | null>;
  /** Return null instead of throwing on a 404 (e.g. "not a verified contract"). */
  okOn404?: boolean;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  // Built as one absolute string first, then re-parsed only to attach query
  // params — `new URL(path, base)` would silently drop `/api` from
  // baseUrl when path starts with "/", since a leading slash is
  // origin-relative, not base-relative.
  const url = new URL(`${trimmedBase}${trimmedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Thin, generic HTTP client for the Blockscout v2 REST API. Endpoint paths
 * and response-shape mapping live in RobinhoodAdapter — this class only
 * handles the Cloudflare UA requirement, JSON parsing, and retry/backoff.
 */
export class BlockscoutClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: BlockscoutClientOptions) {
    this.baseUrl = options.baseUrl;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  async get<T>(path: string, options: BlockscoutGetOptions = {}): Promise<T | null> {
    const url = buildUrl(this.baseUrl, path, options.query);

    return withRetry(
      async () => {
        const res = await this.fetchImpl(url, {
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
        });

        if (res.status === 404 && options.okOn404) {
          return null;
        }

        // Observed live: real 429s never occurred even under a rapid burst,
        // but intermittent plain 500s did. Retry both.
        if (res.status === 429 || res.status >= 500) {
          const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
          throw new BlockscoutHttpError(
            `Blockscout request failed: ${res.status} ${path}`,
            res.status,
            retryAfterMs,
          );
        }

        if (!res.ok) {
          const body = await safeReadText(res);
          throw new BlockscoutHttpError(
            `Blockscout request failed: ${res.status} ${path} — ${body}`,
            res.status,
          );
        }

        return (await res.json()) as T;
      },
      { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs, maxDelayMs: this.maxDelayMs },
      // Only 429/5xx are transient. A 422 (malformed address) or other 4xx
      // will never succeed on retry — 03-CLAUDE-BUILD-PROMPT.md's error
      // handling rule: don't retry permanent validation failures forever.
      (error) =>
        error instanceof BlockscoutHttpError && (error.status === 429 || error.status >= 500),
      this.sleepImpl,
    );
  }
}
