import { NotImplementedError, ROBINHOOD_CHAIN_SLUG, RobinhoodAdapter } from "@alpharadar/chain";
import { getEnv } from "@alpharadar/config";
import { prisma } from "@alpharadar/database";
import { runPollingDriver } from "./drivers/polling-driver.js";

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
    pollBlockChunkSize: BigInt(env.POLL_BLOCK_CHUNK_SIZE),
  });

  if (env.RUN_MODE === "stream") {
    throw new NotImplementedError(
      "RUN_MODE=stream is not implemented in this slice. See " +
        "apps/pipeline/src/drivers/streaming-driver.ts and " +
        "docs/spec/09-INFRASTRUCTURE-DECISION.md §11.",
    );
  }

  await runPollingDriver({
    prisma,
    chainAdapter,
    chain: ROBINHOOD_CHAIN_SLUG,
    maxBlocksPerRun: BigInt(env.MAX_BLOCKS_PER_RUN),
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
