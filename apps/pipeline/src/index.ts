import { NotImplementedError, ROBINHOOD_CHAIN_SLUG, RobinhoodAdapter } from "@alpharadar/chain";
import { getEnv } from "@alpharadar/config";
import { prisma } from "@alpharadar/database";
import { TelegramClient } from "@alpharadar/telegram";
import { runPollingDriver } from "./drivers/polling-driver.js";
import { log } from "./logger.js";

/**
 * Entry point: `pnpm pipeline`. Selects a driver by RUN_MODE — the seam
 * 09 §11 asks for, so switching modes later is a config change, not a
 * refactor. PollingDriver is the only one implemented; RUN_MODE=stream is
 * a deliberate hard failure until StreamingDriver exists (see
 * ./drivers/streaming-driver.ts).
 */
async function main(): Promise<void> {
  const env = getEnv();

  const chainAdapter = new RobinhoodAdapter({
    rpcUrl: env.ROBINHOOD_RPC_URL,
    explorerApiUrl: env.ROBINHOOD_EXPLORER_API_URL,
    explorerUrl: env.ROBINHOOD_EXPLORER_URL,
    pollBlockChunkSize: BigInt(env.POLL_BLOCK_CHUNK_SIZE),
    // Same log stream as everything else in this process — the
    // discovery-scan timing instrumentation (packages/chain) reads
    // alongside pipeline.run.* lines, not as a separate, harder-to-find
    // console stream.
    logger: log,
  });

  if (env.RUN_MODE === "stream") {
    throw new NotImplementedError(
      "RUN_MODE=stream is not implemented in this slice. See " +
        "apps/pipeline/src/drivers/streaming-driver.ts and " +
        "docs/spec/09-INFRASTRUCTURE-DECISION.md §11.",
    );
  }

  // TELEGRAM_BOT_TOKEN is optional at the schema level (dev/test can run
  // without it) — a run with no token configured still completes, with
  // every would-be delivery recorded as an Alert row with deliveryStatus
  // FAILED (alert.ts), not a crashed pipeline.
  const telegramClient = env.TELEGRAM_BOT_TOKEN
    ? new TelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN })
    : null;

  await runPollingDriver({
    prisma,
    chainAdapter,
    chain: ROBINHOOD_CHAIN_SLUG,
    maxBlocksPerRun: BigInt(env.MAX_BLOCKS_PER_RUN),
    telegramClient,
    alertConfig: {
      alertMinScore: env.ALERT_MIN_SCORE,
      maxPerUserPerHour: env.ALERT_MAX_PER_USER_PER_HOUR,
      dedupeWindowHours: env.ALERT_DEDUPE_WINDOW_HOURS,
      webUrl: env.WEB_URL,
    },
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
