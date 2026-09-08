import type { ChainAdapter } from "@alpharadar/chain";
import type { PrismaClient } from "@alpharadar/database";
import { alert } from "./pipeline/alert.js";
import { analyze } from "./pipeline/analyze.js";
import { ingest } from "./pipeline/ingest.js";
import { resolve } from "./pipeline/resolve.js";
import { score } from "./pipeline/score.js";
import { verify } from "./pipeline/verify.js";

export interface PipelineDeps {
  prisma: PrismaClient;
  chainAdapter: ChainAdapter;
  chain: string;
}

export interface PipelineRunSummary {
  candidatesScanned: number;
  nftMintSignalsFound: number;
  tokenLaunchSignalsFound: number;
  opportunitiesCreated: number;
  opportunitiesDeduplicated: number;
}

/**
 * Core. Does all the work for [fromBlock, toBlock] and nothing else — no
 * reference to cron, schedules, sockets, or process lifetime, and no
 * reference to the checkpoint. Whatever invoked it (PollingDriver today; a
 * future StreamingDriver, once per block) is responsible for computing the
 * range and for advancing the checkpoint only after this resolves — see
 * ./checkpoint.ts and 09 §11.
 *
 * Structured as the named stages from 09 §6, each in its own module,
 * called in sequence: ingest -> resolve -> verify -> score -> analyze ->
 * alert. verify/score/analyze/alert are stubs in this slice (project
 * instructions) but are still wired into the sequence, so filling one in
 * later is a change inside that module, not a change to this orchestration.
 *
 * verify/score/analyze/alert only run over opportunities resolve()
 * actually created this call — an opportunity found via dedup (already
 * existed, nothing new happened) doesn't need reprocessing.
 */
export async function runPipeline(
  fromBlock: bigint,
  toBlock: bigint,
  deps: PipelineDeps,
): Promise<PipelineRunSummary> {
  const ingestResult = await ingest(deps.chainAdapter, deps.prisma, {
    fromBlock,
    toBlock,
    chain: deps.chain,
  });

  const resolveResult = await resolve(deps.prisma, ingestResult, { chain: deps.chain });

  for (const opportunityId of resolveResult.createdOpportunityIds) {
    await verify(opportunityId);
    await score(opportunityId);
    await analyze(opportunityId);
    await alert(opportunityId);
  }

  return {
    candidatesScanned: ingestResult.candidatesScanned,
    nftMintSignalsFound: ingestResult.nftMintSignals.length,
    tokenLaunchSignalsFound: ingestResult.tokenLaunchSignals.length,
    opportunitiesCreated: resolveResult.createdOpportunityIds.length,
    opportunitiesDeduplicated: resolveResult.deduplicatedCount,
  };
}
