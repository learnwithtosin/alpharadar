import type { PrismaClient } from "@alpharadar/database";
import { handleSettings } from "./commands/settings.js";
import { handleStart } from "./commands/start.js";
import { handleStop } from "./commands/stop.js";
import type { CommandResult } from "./commands/types.js";
import type { TelegramUpdate } from "./client.js";

type DispatchPrisma = Pick<PrismaClient, "telegramAccount" | "user">;

export interface DispatchConfig {
  /** Seeds a new user's UserSettings.minimumScore — ALERT_MIN_SCORE. */
  defaultMinimumScore: number;
  webUrl: string;
}

/**
 * A command is the first `/word`, optionally followed by `@BotUsername`
 * (Telegram appends this in group chats) — confirmed against Telegram's
 * own Bot API command syntax. Anything else in the message is ignored;
 * none of /start, /settings, /stop take arguments.
 */
export function parseCommand(text: string): string | null {
  const match = /^\/([a-zA-Z0-9_]+)(?:@\S+)?/.exec(text.trim());
  return match ? (match[1] as string).toLowerCase() : null;
}

/**
 * Connects a raw TelegramUpdate to the existing command handlers —
 * transport-agnostic (works the same whether the update arrived via
 * long-polling or, later, a webhook). Returns null for anything that
 * isn't a recognized command (including non-command messages), which the
 * caller should just not reply to.
 */
export async function dispatchUpdate(
  update: TelegramUpdate,
  prisma: DispatchPrisma,
  config: DispatchConfig,
): Promise<{ chatId: string; result: CommandResult } | null> {
  if (!update.message) return null;
  const { message } = update;
  const command = parseCommand(message.text);

  switch (command) {
    case "start": {
      const result = await handleStart(
        prisma,
        {
          telegramUserId: message.fromUserId,
          chatId: message.chatId,
          username: message.fromUsername,
        },
        config.defaultMinimumScore,
      );
      return { chatId: message.chatId, result };
    }
    case "settings": {
      const result = await handleSettings(
        prisma,
        { telegramUserId: message.fromUserId },
        config.webUrl,
      );
      return { chatId: message.chatId, result };
    }
    case "stop": {
      const result = await handleStop(prisma, { telegramUserId: message.fromUserId });
      return { chatId: message.chatId, result };
    }
    default:
      return null;
  }
}
