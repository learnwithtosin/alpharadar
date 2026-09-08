import type { ChainAdapter } from "@alpharadar/chain";
import type { PrismaClient } from "@alpharadar/database";
import { advanceCheckpoint, getNextRange, recordRunFailure } from "../checkpoint.js";
import { log } from "../logger.js";
import { runPipeline } from "../run-pipeline.js";

export interface PollingDriverDeps {
  prisma: PrismaClient;
  chainAdapter: ChainAdapter;
  chain: string;
  /** See checkpoint.ts's getNextRange — how many most-recent blocks a single run may scan. */
  maxBlocksPerRun: bigint;
}

/**
 * RUN_MODE=poll — the only driver implemented in this slice. Reads
 * IngestionCheckpoint, calls runPipeline from there to the current head,
 * advances the checkpoint, exits. One invocation, one range, then done —
 * the process lifetime (when to wake up again) lives entirely outside this
 * function, in whatever schedules it (GitHub Actions cron per 09 §4).
 *
 * The checkpoint only advances after runPipeline resolves. If runPipeline
 * throws — including if the process is killed mid-run, in which case this
 * catch block never even runs — the checkpoint is left exactly where it
 * was, so the next invocation's getNextRange re-derives the same range
 * instead of skipping it.
 */
export async function runPollingDriver(deps: PollingDriverDeps): Promise<void> {
  log.info("pipeline.run.start", { chain: deps.chain });

  const currentHead = await deps.chainAdapter.getLatestBlockNumber();
  const range = await getNextRange(deps.prisma, deps.chain, currentHead, deps.maxBlocksPerRun);

  if (range === null) {
    log.info("pipeline.run.no_new_blocks", { chain: deps.chain, currentHead });
    return;
  }

  log.info("pipeline.run.range", {
    chain: deps.chain,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    blockCount: range.toBlock - range.fromBlock + 1n,
  });

  try {
    const summary = await runPipeline(range.fromBlock, range.toBlock, {
      prisma: deps.prisma,
      chainAdapter: deps.chainAdapter,
      chain: deps.chain,
    });
    await advanceCheckpoint(deps.prisma, deps.chain, range.toBlock);

    log.info("pipeline.run.complete", {
      chain: deps.chain,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      newCheckpoint: range.toBlock,
      candidatesScanned: summary.candidatesScanned,
      nftMintSignalsFound: summary.nftMintSignalsFound,
      tokenLaunchSignalsFound: summary.tokenLaunchSignalsFound,
      opportunitiesCreated: summary.opportunitiesCreated,
      opportunitiesDeduplicated: summary.opportunitiesDeduplicated,
    });
  } catch (error) {
    await recordRunFailure(
      deps.prisma,
      deps.chain,
      error instanceof Error ? error.message : String(error),
    );
    log.error("pipeline.run.failed", error, {
      chain: deps.chain,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    throw error;
  }
}
