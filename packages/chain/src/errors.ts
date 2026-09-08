/**
 * Thrown by adapter methods that are declared on the ChainAdapter interface
 * but not implemented in this slice. See
 * docs/spec/09-INFRASTRUCTURE-DECISION.md §11 — subscribeToBlocks() is
 * declared now, on the first commit, specifically so the interface never
 * needs to change when it's implemented later.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * A non-2xx response from the Blockscout API that wasn't treated as a
 * expected "not found" (see BlockscoutClient's okOn404 option). Carries the
 * HTTP status and, for 429s, any Retry-After the server sent, so callers
 * (and the retry loop) can react to the specific failure.
 */
export class BlockscoutHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "BlockscoutHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The RPC endpoint served a Cloudflare managed-challenge response (a 403
 * with `cf-mitigated: challenge`, or an HTML "Just a moment..." body where
 * JSON-RPC was expected) instead of an actual RPC response. Deliberately a
 * distinct, named class — not a generic HTTP or parse error — so this
 * failure mode is unmistakable in a log line rather than looking like a
 * malformed-response bug. Confirmed live (this session): intermittent,
 * could not be reproduced on demand across 200 sequential
 * eth_getBlockReceipts calls — see
 * docs/decisions/0009-rpc-cloudflare-challenge.md.
 */
export class CloudflareChallengeError extends Error {
  readonly method: string;
  readonly httpStatus: number | undefined;

  constructor(message: string, method: string, httpStatus?: number) {
    super(message);
    this.name = "CloudflareChallengeError";
    this.method = method;
    this.httpStatus = httpStatus;
  }
}

/**
 * A non-2xx, non-challenge response from the RPC endpoint (429/5xx) —
 * transient, unlike a real JSON-RPC error (bad params, etc.), which is
 * thrown as a plain Error and never retried. Mirrors BlockscoutHttpError's
 * shape for the same reason: the retry loop needs the status to decide.
 */
export class RpcHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RpcHttpError";
    this.status = status;
  }
}
