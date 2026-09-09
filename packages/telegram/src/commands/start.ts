import type { PrismaClient } from "@alpharadar/database";
import type { CommandResult } from "./types.js";

type StartPrisma = Pick<PrismaClient, "telegramAccount" | "user">;

export interface StartInput {
  telegramUserId: string;
  chatId: string;
  username: string | null;
}

/**
 * docs/decisions/0004-telegram-first-identity.md: /start *is* account
 * creation. First contact from a given telegramUserId creates the User
 * row (with a UserSettings row seeded from defaultMinimumScore —
 * ALERT_MIN_SCORE — per the schema comment on UserSettings.minimumScore)
 * plus its TelegramAccount, one nested write, idempotent. A returning
 * user (already has a TelegramAccount) is reactivated and re-linked to
 * whatever chat/username sent /start this time, rather than creating a
 * second account — the unique constraint on telegramUserId makes a
 * duplicate impossible either way, this just avoids a needless update
 * when nothing changed.
 */
export async function handleStart(
  prisma: StartPrisma,
  input: StartInput,
  defaultMinimumScore: number,
): Promise<CommandResult> {
  const existing = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: input.telegramUserId },
  });

  if (existing) {
    if (
      !existing.isActive ||
      existing.chatId !== input.chatId ||
      existing.username !== input.username
    ) {
      await prisma.telegramAccount.update({
        where: { id: existing.id },
        data: { isActive: true, chatId: input.chatId, username: input.username },
      });
    }
    return {
      replyText:
        "Welcome back — alerts are on. Use /settings to review your preferences, or /stop to pause.",
    };
  }

  await prisma.user.create({
    data: {
      settings: { create: { minimumScore: defaultMinimumScore } },
      telegramAccount: {
        create: {
          telegramUserId: input.telegramUserId,
          chatId: input.chatId,
          username: input.username,
        },
      },
    },
  });

  return {
    replyText:
      "You're connected. AlphaRadar will alert you here for new opportunities. Use /settings to review your preferences, or /stop to pause.",
  };
}
