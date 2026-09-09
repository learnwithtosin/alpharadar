import type { PrismaClient } from "@alpharadar/database";
import type { CommandResult } from "./types.js";

type StopPrisma = Pick<PrismaClient, "telegramAccount">;

export interface StopInput {
  telegramUserId: string;
}

/**
 * Deactivates the TelegramAccount link (isActive=false) — the alert
 * stage's per-user gate checks this, so a stopped account stops receiving
 * alerts immediately regardless of UserSettings.telegramEnabled, which is
 * left untouched: isActive means "this chat link is live", telegramEnabled
 * is a separate preference for while it is. /start reactivates isActive.
 */
export async function handleStop(prisma: StopPrisma, input: StopInput): Promise<CommandResult> {
  const account = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: input.telegramUserId },
  });

  if (!account) {
    return { replyText: "You haven't connected AlphaRadar yet — nothing to stop." };
  }

  if (account.isActive) {
    await prisma.telegramAccount.update({ where: { id: account.id }, data: { isActive: false } });
  }

  return { replyText: "Alerts stopped. Send /start any time to reconnect." };
}
