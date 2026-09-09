import { describe, expect, it, vi } from "vitest";
import { handleStart } from "./start.js";

function makePrisma(existingAccount: unknown = null) {
  return {
    telegramAccount: {
      findUnique: vi.fn().mockResolvedValue(existingAccount),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
  };
}

const INPUT = { telegramUserId: "tg-1", chatId: "chat-1", username: "alice" };

describe("handleStart", () => {
  it("creates a User with a nested UserSettings (seeded from ALERT_MIN_SCORE) and TelegramAccount for a first-time sender", async () => {
    const prisma = makePrisma(null);

    const result = await handleStart(prisma as never, INPUT, 60);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        settings: { create: { minimumScore: 60 } },
        telegramAccount: {
          create: { telegramUserId: "tg-1", chatId: "chat-1", username: "alice" },
        },
      },
    });
    expect(result.replyText).toContain("connected");
  });

  it("does not create a second User for a returning telegramUserId", async () => {
    const prisma = makePrisma({
      id: "acct-1",
      isActive: true,
      chatId: "chat-1",
      username: "alice",
    });

    await handleStart(prisma as never, INPUT, 60);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("reactivates a stopped account and updates chat/username on re-/start", async () => {
    const prisma = makePrisma({
      id: "acct-1",
      isActive: false,
      chatId: "old-chat",
      username: "old-name",
    });

    await handleStart(prisma as never, INPUT, 60);

    expect(prisma.telegramAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { isActive: true, chatId: "chat-1", username: "alice" },
    });
  });

  it("skips the update entirely when nothing changed — idempotent /start", async () => {
    const prisma = makePrisma({
      id: "acct-1",
      isActive: true,
      chatId: "chat-1",
      username: "alice",
    });

    await handleStart(prisma as never, INPUT, 60);

    expect(prisma.telegramAccount.update).not.toHaveBeenCalled();
  });
});
