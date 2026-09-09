/**
 * =====================================================================
 *  DEVELOPMENT / INTERACTIVE TOOLING — not part of the production
 *  pipeline. Never invoked by run-pipeline.ts, polling-driver.ts, or any
 *  cron job — this is a process you start by hand, in a terminal you
 *  keep open, when you want to link a Telegram account or exercise
 *  /settings and /stop. Stop it with Ctrl+C when you're done; nothing
 *  else in this project depends on it running.
 * =====================================================================
 *
 * Long-polling entry point for the /start, /settings, /stop command
 * handlers (packages/telegram). Long-polling (Telegram's getUpdates),
 * not a webhook — a webhook needs a publicly reachable HTTPS URL, which
 * this project has no deployed listener to provide.
 *
 * Usage: pnpm bot
 */
import { getEnv } from "@alpharadar/config";
import { prisma } from "@alpharadar/database";
import { dispatchUpdate, TelegramClient } from "@alpharadar/telegram";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error("[bot] TELEGRAM_BOT_TOKEN is not set in .env — cannot start the bot.");
    process.exit(1);
    return;
  }

  const telegramClient = new TelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const dispatchConfig = { defaultMinimumScore: env.ALERT_MIN_SCORE, webUrl: env.WEB_URL };

  // Purely informational (prints the bot's @username so you know who to
  // message) — never fatal. The getUpdates loop below is what the bot
  // actually depends on, and it already retries transient network
  // failures on its own; this call shouldn't crash the whole process if
  // it hits one first.
  try {
    const me = await telegramClient.getMe();
    console.info(
      me.username
        ? `[bot] Connected as @${me.username}. Open Telegram and message /start to that bot.`
        : `[bot] Connected (bot id ${me.id}, no @username set on this bot).`,
    );
  } catch (error) {
    console.warn("[bot] Couldn't fetch bot info (continuing anyway):", error);
  }

  // Exit immediately on Ctrl+C rather than waiting for the in-flight
  // long-poll (up to 30s) to return on its own — nothing here has a
  // partial-write to protect: getUpdates hasn't consumed anything until
  // it returns, and dispatchUpdate/sendMessage only ever run between
  // polls, never concurrently with one.
  process.on("SIGINT", () => {
    console.info("\n[bot] Stopping (Ctrl+C received)...");
    process.exit(0);
  });

  console.info("[bot] Long-polling for updates. Press Ctrl+C to stop.");

  let offset: number | undefined;

  for (;;) {
    let updates;
    try {
      updates = await telegramClient.getUpdates({ offset, timeoutSeconds: 30 });
    } catch (error) {
      console.error("[bot] getUpdates failed, retrying in 3s:", error);
      await sleep(3000);
      continue;
    }

    for (const update of updates) {
      offset = update.updateId + 1;

      if (update.message) {
        console.info(
          `[bot] Received "${update.message.text}" from ${
            update.message.fromUsername ?? update.message.fromUserId
          }`,
        );
      }

      try {
        const dispatched = await dispatchUpdate(update, prisma, dispatchConfig);
        if (dispatched === null) continue;

        await telegramClient.sendMessage({
          chatId: dispatched.chatId,
          text: dispatched.result.replyText,
        });
        console.info(`[bot] Replied: ${dispatched.result.replyText.split("\n")[0]}`);
      } catch (error) {
        console.error("[bot] Failed to handle update", update.updateId, ":", error);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error("[bot] Fatal error:", error);
  process.exit(1);
});
