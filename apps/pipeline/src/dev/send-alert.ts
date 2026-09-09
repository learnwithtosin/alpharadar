/**
 * =====================================================================
 *  DEVELOPMENT TOOLING — not part of the production pipeline.
 *  Not invoked by run-pipeline.ts, the polling driver, or any cron job.
 * =====================================================================
 *
 * Sends the alert for a given opportunity on demand, so the Telegram
 * delivery path (rules, template rendering, Alert persistence) can be
 * exercised without waiting for a live token launch to be detected and
 * scored by a real pipeline run. Runs the exact same alert() stage the
 * real pipeline uses — same four rules, same templates, same Alert-row
 * writes — against whatever opportunity ID you give it, real or seeded
 * (see seed-test-opportunity.ts).
 *
 * Usage: pnpm send-alert <opportunityId>
 */
import { getEnv } from "@alpharadar/config";
import { prisma } from "@alpharadar/database";
import { TelegramClient } from "@alpharadar/telegram";
import { alert } from "../pipeline/alert.js";

async function main(): Promise<void> {
  const opportunityId = process.argv[2];
  if (!opportunityId) {
    console.error("Usage: pnpm send-alert <opportunityId>");
    process.exit(1);
    return;
  }

  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn(
      "[dev tooling] TELEGRAM_BOT_TOKEN is not set in .env — alert() will still run and " +
        "apply all four rules, but every delivery that would otherwise send will be " +
        "recorded as FAILED instead of SENT (see apps/pipeline/src/pipeline/alert.ts).",
    );
  }
  const telegramClient = env.TELEGRAM_BOT_TOKEN
    ? new TelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN })
    : null;

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity) {
    console.error(`[dev tooling] No opportunity found with id ${opportunityId}`);
    process.exit(1);
    return;
  }

  const beforeRowIds = new Set(
    (await prisma.alert.findMany({ where: { opportunityId }, select: { id: true } })).map(
      (row) => row.id,
    ),
  );

  console.info(
    `[dev tooling] Sending alert for opportunity ${opportunityId} (${opportunity.title})...`,
  );

  await alert(opportunityId, prisma, telegramClient, {
    alertMinScore: env.ALERT_MIN_SCORE,
    maxPerUserPerHour: env.ALERT_MAX_PER_USER_PER_HOUR,
    dedupeWindowHours: env.ALERT_DEDUPE_WINDOW_HOURS,
    webUrl: env.WEB_URL,
  });

  const afterRows = await prisma.alert.findMany({ where: { opportunityId } });
  const newRows = afterRows.filter((row) => !beforeRowIds.has(row.id));

  console.info(`[dev tooling] alert() wrote ${newRows.length} Alert row(s):`);
  for (const row of newRows) {
    console.info({
      id: row.id,
      userId: row.userId,
      deliveryStatus: row.deliveryStatus,
      suppressedReason: row.suppressedReason,
      sentAt: row.sentAt,
    });
  }
  if (newRows.length === 0) {
    console.info(
      "[dev tooling] No Alert rows were written at all — this means alert() itself " +
        "threw before persisting anything (e.g. an unsupported opportunity type). " +
        "Check the error output above.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[dev tooling] send-alert failed:", error);
    process.exit(1);
  });
