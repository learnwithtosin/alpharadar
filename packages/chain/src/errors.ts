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
