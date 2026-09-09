import type { PrismaClient } from "@alpharadar/database";
import type { CommandResult } from "./types.js";

type SettingsPrisma = Pick<PrismaClient, "telegramAccount">;

export interface SettingsInput {
  telegramUserId: string;
}

/**
 * Read-only in this slice: reports the caller's current UserSettings
 * (seeded at /start) and points them at the web /settings page (02 §15)
 * to change them. No bot-side mutation syntax is invented here — there's
 * no spec text defining one, and the web page is already the intended
 * place to edit settings; duplicating that as untested bot commands would
 * risk the two drifting out of sync.
 */
export async function handleSettings(
  prisma: SettingsPrisma,
  input: SettingsInput,
  webUrl: string,
): Promise<CommandResult> {
  const account = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: input.telegramUserId },
    include: { user: { include: { settings: true } } },
  });

  if (!account) {
    return { replyText: "You haven't connected AlphaRadar yet — send /start first." };
  }

  const settings = account.user.settings;
  const telegramEnabled = settings?.telegramEnabled ?? true;
  const minimumScore = settings?.minimumScore ?? null;
  const types = settings?.enabledOpportunityTypes.length
    ? settings.enabledOpportunityTypes.join(", ")
    : "all types";

  return {
    replyText: [
      "Your settings:",
      `Alerts: ${account.isActive && telegramEnabled ? "on" : "off"}`,
      `Minimum score: ${minimumScore ?? "unknown"}/100`,
      `Opportunity types: ${types}`,
      "",
      `Change these at ${webUrl}/settings`,
    ].join("\n"),
  };
}
