// StreamingDriver — NOT IMPLEMENTED.
//
// RUN_MODE=stream is not a valid runtime path yet: apps/pipeline/src/index.ts
// throws NotImplementedError if it's selected. This file exists only to
// record the intended shape, per docs/spec/09-INFRASTRUCTURE-DECISION.md
// §11, so that building it later is filling in a known gap, not designing
// from scratch.
//
// import type { ChainAdapter } from "@alpharadar/chain";
// import type { PrismaClient } from "@alpharadar/database";
// import { advanceCheckpoint, getNextRange, recordRunFailure } from "../checkpoint.js";
// import { runPipeline } from "../run-pipeline.js";
//
// export interface StreamingDriverDeps {
//   prisma: PrismaClient;
//   chainAdapter: ChainAdapter; // RobinhoodAdapter.subscribeToBlocks() must be
//                               // implemented first — currently throws
//                               // NotImplementedError. See packages/chain.
//   chain: string;
// }
//
// export async function runStreamingDriver(deps: StreamingDriverDeps): Promise<void> {
//   // 1. Backfill — identical to PollingDriver, and for the same reason:
//   //    a crash, a deploy, or a dropped socket must resume from the same
//   //    durable checkpoint either driver would use. Same three functions,
//   //    not reimplemented:
//   const currentHead = await deps.chainAdapter.getLatestBlockNumber();
//   const backfillRange = await getNextRange(deps.prisma, deps.chain, currentHead);
//   if (backfillRange) {
//     try {
//       await runPipeline(backfillRange.fromBlock, backfillRange.toBlock, deps);
//       await advanceCheckpoint(deps.prisma, deps.chain, backfillRange.toBlock);
//     } catch (error) {
//       await recordRunFailure(deps.prisma, deps.chain, String(error));
//       throw error;
//     }
//   }
//
//   // 2. Subscribe — one runPipeline call per new block, checkpoint
//   //    advanced the same way after each one commits:
//   await deps.chainAdapter.subscribeToBlocks(async (block) => {
//     try {
//       await runPipeline(block.number, block.number, deps);
//       await advanceCheckpoint(deps.prisma, deps.chain, block.number);
//     } catch (error) {
//       await recordRunFailure(deps.prisma, deps.chain, String(error));
//       // Deliberately does not rethrow here — one bad block should not
//       // kill a long-lived subscription the way it kills a one-shot poll.
//     }
//   });
//
//   // 3. Unlike PollingDriver, this function then runs until the process is
//   //    stopped — the long-lived process lifetime lives here, in the
//   //    driver, never in runPipeline itself (which still has no idea it's
//   //    being driven by a subscription rather than a cron job).
// }

export {};
