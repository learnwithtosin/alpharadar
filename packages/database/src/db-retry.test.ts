import { Prisma } from "../generated/client/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDbRetry } from "./db-retry.js";

function connectionError(): Prisma.PrismaClientInitializationError {
  return new Prisma.PrismaClientInitializationError(
    "Can't reach database server at `aws-0-eu-central-1.pooler.supabase.com`:`6543`",
    "6.19.3",
    "P1001",
  );
}

/**
 * Same error *class* as connectionError(), deliberately no errorCode —
 * matches what a missing query-engine binary actually threw back when
 * this project still shipped a native engine at all (confirmed live
 * against the real Prisma client at the time). No longer a scenario that
 * can literally happen post-migration to @prisma/adapter-pg (no native
 * engine left to go missing) — kept as cheap defensive coverage for "an
 * InitializationError with a non-P1001/undefined code is never retried,"
 * which is still the correct behavior regardless of cause.
 */
function missingEngineError(): Prisma.PrismaClientInitializationError {
  return new Prisma.PrismaClientInitializationError(
    'Prisma Client could not locate the Query Engine for runtime "rhel-openssl-3.0.x".',
    "6.19.3",
  );
}

/**
 * What an *actively refused* connection (nothing listening on the port)
 * actually throws through @prisma/adapter-pg — confirmed live against a
 * real, deliberately-unreachable port. A different error CLASS than
 * connectionError() above despite the identical P1001 code and message:
 * `PrismaClientKnownRequestError`'s `code`, not
 * `PrismaClientInitializationError`'s `errorCode`.
 */
function adapterRefusedError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Can't reach database server at `127.0.0.1:54329`",
    { code: "P1001", clientVersion: "6.19.3" },
  );
}

/**
 * What a *timed-out* connection actually throws through
 * @prisma/adapter-pg — confirmed live twice: once against a deliberately
 * unreachable host, and once caught by accident against the real,
 * unmodified pooler mid-outage. Not any Prisma error class at all —
 * `PrismaPgAdapter.performIO` rethrows pg-pool's own generic timeout
 * error almost verbatim, as a plain `Error` (prototype chain literally
 * `Error -> Object`), stamped only with `clientVersion`. This is the
 * shape this project's real pooler outages actually take (decision
 * 0020: every observed outage timed out at a uniform ~5s, never an
 * active refusal) — the branch above (adapterRefusedError) is defensive
 * coverage, this one is the case that matters in production.
 */
function adapterTimeoutError(): Error {
  const error = new Error("Connection terminated due to connection timeout");
  Object.assign(error, { clientVersion: "6.19.3" });
  return error;
}

describe("withDbRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result on the first try when nothing fails", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withDbRetry("op", fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a connection error and succeeds once the connection recovers", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(connectionError())
      .mockRejectedValueOnce(connectionError())
      .mockResolvedValueOnce("recovered");

    const promise = withDbRetry("op", fn);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("recovered");

    expect(fn).toHaveBeenCalledTimes(3);
    const retries = logSpy.mock.calls
      .map(([line]) => JSON.parse(line as string) as Record<string, unknown>)
      .filter((e) => e.event === "db.retry");
    expect(retries).toHaveLength(2);
    expect(retries[0]).toMatchObject({ operation: "op", attempt: 1, maxAttempts: 20 });
    logSpy.mockRestore();
  });

  it("gives up after the bounded max attempts and throws — does not retry forever", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(connectionError());

    const promise = withDbRetry("op", fn);
    const assertion = expect(promise).rejects.toThrow("Can't reach database server");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(20);
    logSpy.mockRestore();
  });

  it("does not retry a real query error — only connection-level failures", async () => {
    const queryError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.19.3",
    });
    const fn = vi.fn().mockRejectedValue(queryError);

    await expect(withDbRetry("op", fn)).rejects.toThrow("Unique constraint failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a missing query-engine error — same error class as a connection failure, but never transient", async () => {
    const fn = vi.fn().mockRejectedValue(missingEngineError());

    await expect(withDbRetry("op", fn)).rejects.toThrow("could not locate the Query Engine");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries an adapter-surfaced actively-refused connection error (PrismaClientKnownRequestError, code P1001)", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(adapterRefusedError())
      .mockResolvedValueOnce("recovered");

    const promise = withDbRetry("op", fn);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("recovered");

    expect(fn).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });

  it("retries an adapter-surfaced connection timeout (plain Error, no Prisma class) — the real-world shape", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(adapterTimeoutError())
      .mockResolvedValueOnce("recovered");

    const promise = withDbRetry("op", fn);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("recovered");

    expect(fn).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });

  it("does not retry an unrelated plain Error — the timeout-shape match must not swallow ordinary bugs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("TypeError-ish bug, nothing to do with the DB"));

    await expect(withDbRetry("op", fn)).rejects.toThrow("TypeError-ish bug");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a clientVersion-stamped Error whose message doesn't match the timeout shape", async () => {
    const error = new Error("Something else entirely");
    Object.assign(error, { clientVersion: "6.19.3" });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withDbRetry("op", fn)).rejects.toThrow("Something else entirely");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
