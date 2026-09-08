import { CloudflareChallengeError, RpcHttpError } from "./errors.js";
import { sleep, withRetry, type RetryOptions } from "./retry.js";

export interface RpcClientOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface JsonRpcCall {
  method: string;
  params?: unknown[];
}

interface JsonRpcResponseBody {
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * True if a response looks like a Cloudflare managed challenge rather than
 * a real JSON-RPC response — pure and exported so this detection is
 * directly testable without a network call. `cf-mitigated: challenge` is
 * the definitive signal (confirmed live, this session's original report);
 * the body/status checks are a fallback for a challenge response that
 * omits that header.
 */
export function isCloudflareChallengeResponse(
  status: number,
  cfMitigated: string | null,
  bodyText: string,
): boolean {
  if (cfMitigated?.toLowerCase() === "challenge") return true;
  if (status !== 403) return false;
  if (/Just a moment|challenge-platform|Enable JavaScript and cookies/i.test(bodyText)) return true;
  // Real JSON-RPC never returns HTML — a 403 with an HTML body where JSON
  // was expected is a challenge page even without the exact phrases above.
  return bodyText.trimStart().startsWith("<");
}

/**
 * An EIP-1193-shaped provider (`{ request({method, params}) }`) backed by a
 * raw fetch this adapter fully controls, meant to be passed to viem's
 * `custom()` transport. Passing this instead of viem's own `http()`
 * transport means *every* RPC call — viem's high-level actions
 * (getBlock, readContract, ...) and this adapter's hand-rolled raw
 * `client.request()` calls (eth_getLogs, eth_getBlockReceipts) alike —
 * goes through the same Cloudflare-challenge detection, not just the
 * couple of calls that happen to be hand-rolled already.
 *
 * A challenge is retried with backoff like a 429/5xx; if it still hasn't
 * cleared after maxAttempts, it's thrown as CloudflareChallengeError — a
 * distinctly-named class specifically so a caller's log line reads "the
 * RPC endpoint is challenging us," not a generic HTTP or parse failure
 * buried in a stack trace. Confirmed live (this session): could not be
 * reproduced on demand across 200 sequential eth_getBlockReceipts calls —
 * see docs/decisions/0009-rpc-cloudflare-challenge.md. Genuine JSON-RPC
 * errors (bad params, etc.) are never retried — only HTTP-level failures
 * (429/5xx) and challenges are.
 */
export function createRpcProvider(options: RpcClientOptions): {
  request(call: JsonRpcCall): Promise<unknown>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const retryOptions: RetryOptions = {
    maxAttempts: options.maxAttempts ?? 5,
    baseDelayMs: options.baseDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 15_000,
  };

  return {
    async request({ method, params }: JsonRpcCall): Promise<unknown> {
      return withRetry(
        async () => {
          const res = await fetchImpl(options.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
          });
          const bodyText = await res.text();

          if (
            isCloudflareChallengeResponse(res.status, res.headers.get("cf-mitigated"), bodyText)
          ) {
            throw new CloudflareChallengeError(
              `RPC endpoint is challenging this request (${method}) — Cloudflare returned a managed-challenge response instead of a JSON-RPC result.`,
              method,
              res.status,
            );
          }

          if (!res.ok) {
            throw new RpcHttpError(`RPC request failed: ${res.status} ${method}`, res.status);
          }

          let body: JsonRpcResponseBody;
          try {
            body = JSON.parse(bodyText) as JsonRpcResponseBody;
          } catch {
            throw new Error(
              `RPC response for ${method} was not valid JSON (and not a recognized challenge page): ${bodyText.slice(0, 200)}`,
            );
          }

          if (body.error) {
            // A real JSON-RPC error — bad params, etc. Never retryable.
            throw new Error(
              `RPC error (${method}): ${body.error.message} (code ${body.error.code})`,
            );
          }

          return body.result;
        },
        retryOptions,
        (error) =>
          error instanceof CloudflareChallengeError ||
          (error instanceof RpcHttpError && (error.status === 429 || error.status >= 500)),
        sleepImpl,
      );
    },
  };
}
