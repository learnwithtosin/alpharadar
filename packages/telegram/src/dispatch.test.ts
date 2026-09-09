import { describe, expect, it, vi } from "vitest";
import { dispatchUpdate, parseCommand } from "./dispatch.js";
import type { TelegramUpdate } from "./client.js";

describe("parseCommand", () => {
  it("extracts a plain command", () => {
    expect(parseCommand("/start")).toBe("start");
  });

  it("strips a trailing @BotUsername (group-chat form)", () => {
    expect(parseCommand("/start@AlphaRadarBot")).toBe("start");
  });

  it("is case-insensitive", () => {
    expect(parseCommand("/START")).toBe("start");
  });

  it("returns null for a non-command message", () => {
    expect(parseCommand("hello there")).toBeNull();
  });

  it("returns null for an empty message", () => {
    expect(parseCommand("")).toBeNull();
  });
});

function makePrisma() {
  return {
    telegramAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
  };
}

const CONFIG = { defaultMinimumScore: 60, webUrl: "https://alpharadar.test" };

function messageUpdate(text: string): TelegramUpdate {
  return {
    updateId: 1,
    message: { text, chatId: "chat-1", fromUserId: "tg-1", fromUsername: "alice" },
  };
}

describe("dispatchUpdate", () => {
  it("routes /start to handleStart", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(messageUpdate("/start"), prisma as never, CONFIG);

    expect(dispatched).not.toBeNull();
    expect(dispatched?.chatId).toBe("chat-1");
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(dispatched?.result.replyText).toContain("connected");
  });

  it("routes /settings to handleSettings", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(messageUpdate("/settings"), prisma as never, CONFIG);

    expect(dispatched?.result.replyText).toContain("/start");
  });

  it("routes /stop to handleStop", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(messageUpdate("/stop"), prisma as never, CONFIG);

    expect(dispatched?.result.replyText).toContain("nothing to stop");
  });

  it("returns null for an update with no message (e.g. edited_message)", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(
      { updateId: 1, message: null },
      prisma as never,
      CONFIG,
    );

    expect(dispatched).toBeNull();
  });

  it("returns null for a non-command message, without touching the database", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(messageUpdate("hello"), prisma as never, CONFIG);

    expect(dispatched).toBeNull();
    expect(prisma.telegramAccount.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for an unrecognized command", async () => {
    const prisma = makePrisma();

    const dispatched = await dispatchUpdate(messageUpdate("/unknown"), prisma as never, CONFIG);

    expect(dispatched).toBeNull();
  });
});
