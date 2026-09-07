// Placeholder entrypoint — not implemented yet.
//
// This is the scheduled pipeline runner described in
// docs/spec/09-INFRASTRUCTURE-DECISION.md §3 and §6: a driver-agnostic
// `runPipeline(fromBlock, toBlock)` invoked by a PollingDriver (MVP) or, in
// the future, a StreamingDriver, wired up to
// ingest -> resolve -> verify -> score -> analyze -> alert.
//
// Deliberately not implemented in this phase: "Implement the monorepo
// foundation and the complete database schema... Do not implement any
// pipeline logic yet." See the driver/pipeline build prompt for the real
// implementation.

function main(): void {
  console.info("apps/pipeline: no pipeline logic implemented yet.");
}

main();
