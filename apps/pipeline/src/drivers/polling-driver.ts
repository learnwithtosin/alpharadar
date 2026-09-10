import { CloudflareChallengeError, type ChainAdapter } from "@alpharadar/chain";
import type { PrismaClient } from "@alpharadar/database";
import type { TelegramClient } from "@alpharadar/telegram";
import {
  advanceCheckpoint,
  getNextRange,
  recordRunFailure,
  type CheckpointRange,
} from "../checkpoint.js";
import { log } from "../logger.js";
import type { AlertConfig } from "../pipeline/alert.js";
import { runPipeline } from "../run-pipeline.js";

export interface PollingDriverDeps {
  prisma: PrismaClient;
  chainAdapter: ChainAdapter;
  chain: string;
  /** See checkpoint.ts's getNextRange — how many most-recent blocks a single run may scan. */
  maxBlocksPerRun: bigint;
  telegramClient: TelegramClient | null;
  alertConfig: AlertConfig;
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
 *
 * getLatestBlockNumber() and getNextRange() are inside the same try block
 * as the pipeline run itself — a failure on the very first RPC call of a
 * run (e.g. the RPC endpoint challenging us before we've even computed a
 * range) must still hit recordRunFailure and the structured log below, not
 * bypass them and land as a raw, unstructured console dump.
 */
export async function runPollingDriver(deps: PollingDriverDeps): Promise<void> {
  log.info("pipeline.run.start", { chain: deps.chain });

  let range: CheckpointRange | null = null;
  try {
    const currentHead = await deps.chainAdapter.getLatestBlockNumber();
    range = await getNextRange(deps.prisma, deps.chain, currentHead, deps.maxBlocksPerRun);

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

    const summary = await runPipeline(range.fromBlock, range.toBlock, {
      prisma: deps.prisma,
      chainAdapter: deps.chainAdapter,
      chain: deps.chain,
      telegramClient: deps.telegramClient,
      alertConfig: deps.alertConfig,
    });
    await advanceCheckpoint(
      deps.prisma,
      deps.chain,
      range.toBlock,
      range.toBlock - range.fromBlock + 1n,
    );

    log.info("pipeline.run.complete", {
      chain: deps.chain,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      newCheckpoint: range.toBlock,
      candidatesScanned: summary.candidatesScanned,
      candidatesFailed: summary.candidatesFailed,
      nftMintSignalsFound: summary.nftMintSignalsFound,
      tokenLaunchSignalsFound: summary.tokenLaunchSignalsFound,
      opportunitiesCreated: summary.opportunitiesCreated,
      opportunitiesDeduplicated: summary.opportunitiesDeduplicated,
      opportunitiesFailed: summary.opportunitiesFailed,
    });
  } catch (error) {
    await recordRunFailure(
      deps.prisma,
      deps.chain,
      error instanceof Error ? error.message : String(error),
    );

    // A loud, distinctly-named, greppable line — not just a field inside
    // the generic failure log below — so this reads unmistakably in a
    // GitHub Actions log rather than looking like an application bug.
    if (error instanceof CloudflareChallengeError) {
      log.error("pipeline.rpc.challenged", error, {
        chain: deps.chain,
        rpcMethod: error.method,
        httpStatus: error.httpStatus,
        fromBlock: range?.fromBlock,
        toBlock: range?.toBlock,
        message:
          "The RPC endpoint is actively serving a Cloudflare challenge instead of responding to requests.",
      });
    }

    log.error("pipeline.run.failed", error, {
      chain: deps.chain,
      fromBlock: range?.fromBlock,
      toBlock: range?.toBlock,
    });
    throw error;
  }
}
