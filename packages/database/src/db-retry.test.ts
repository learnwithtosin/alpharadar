import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDbRetry } from "./db-retry.js";

function connectionError(): Prisma.PrismaClientInitializationError {
  return new Prisma.PrismaClientInitializationError(
    "Can't reach database server at `aws-0-eu-central-1.pooler.supabase.com`:`6543`",
    "6.19.3",
    "P1001",
  );
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
});
