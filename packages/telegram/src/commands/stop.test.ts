import { describe, expect, it, vi } from "vitest";
import { handleStop } from "./stop.js";

function makePrisma(account: unknown) {
  return {
    telegramAccount: {
      findUnique: vi.fn().mockResolvedValue(account),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

const INPUT = { telegramUserId: "tg-1" };

describe("handleStop", () => {
  it("tells an unknown telegramUserId there's nothing to stop", async () => {
    const prisma = makePrisma(null);

    const result = await handleStop(prisma as never, INPUT);

    expect(result.replyText).toContain("nothing to stop");
    expect(prisma.telegramAccount.update).not.toHaveBeenCalled();
  });

  it("deactivates an active account", async () => {
    const prisma = makePrisma({ id: "acct-1", isActive: true });

    const result = await handleStop(prisma as never, INPUT);

    expect(prisma.telegramAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { isActive: false },
    });
    expect(result.replyText).toContain("Alerts stopped");
  });

  it("is idempotent — does not write again for an already-stopped account", async () => {
    const prisma = makePrisma({ id: "acct-1", isActive: false });

    await handleStop(prisma as never, INPUT);

    expect(prisma.telegramAccount.update).not.toHaveBeenCalled();
  });
});
