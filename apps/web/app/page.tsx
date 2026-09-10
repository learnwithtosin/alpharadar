import Link from "next/link";
import { X } from "lucide-react";
import { unstable_cache } from "next/cache";
import { prisma, withDbRetry } from "@alpharadar/database";
import { BracketHeader } from "@/components/bracket-header";
import { ChainBadge } from "@/components/domain-badges";
import { Section } from "@/components/section";
import { SignalDot } from "@/components/signal-dot";
import { chainToken } from "@/lib/chain-tokens";
import { formatAge, formatMonthYear, isFresh, SCAN_FRESHNESS_THRESHOLD_MS } from "@/lib/format";
import { BODY_TEXT, LABEL_TEXT } from "@/lib/typography";

export const dynamic = "force-dynamic";

/**
 * The real pipeline stages (apps/pipeline/src/run-pipeline.ts), in
 * order — ingest+resolve collapse into "DETECT" (the user-facing event),
 * analyze is excluded (AI_ENABLED defaults false, docs/decisions/0007 —
 * describing a disabled-by-default capability here would overstate what
 * actually runs).
 */
const PIPELINE_STEPS = [
  {
    title: "DETECT",
    body: "Scans every new block for contract creation — NFT mints and ERC-20 launches — as they deploy.",
  },
  {
    title: "VERIFY",
    body: "Checks contract source verification, deployer identity, and deployer history against what's actually on-chain and indexed.",
  },
  {
    title: "SCORE",
    body: "A deterministic 0-100 score from legitimacy, freshness, and on-chain signal. Inputs are stored with every score, so any result can be reproduced.",
  },
  {
    title: "CLASSIFY",
    body: "Contract, concentration, and deployer risk from what's verifiable on-chain. What isn't checked yet stays labeled UNKNOWN — never guessed.",
  },
  {
    title: "ALERT",
    body: "Delivered to Telegram once it clears the score threshold — unless a risk veto blocks it outright, regardless of score.",
  },
];

/**
 * Every line here is sourced, not written from impression — see the
 * inline citations. A trust signal that can't point at its own source
 * isn't one.
 */
const BOUNDARIES = [
  {
    title: "NEVER CUSTODIAL",
    body: "AlphaRadar never takes custody of funds. (01-PROJECT-CONSTITUTION.md §3)",
  },
  {
    title: "NEVER SIGNS TRANSACTIONS",
    body: "AlphaRadar never signs a transaction on your behalf. (§2)",
  },
  {
    title: "NEVER HOLDS KEYS",
    body: "Seed phrases, private keys, and wallet passwords are never requested, received, stored, or logged. (§3)",
  },
  {
    title: "NEVER AUTO-TRADES",
    body: "Never spends, trades, transfers funds, approves token spending, or copies trades automatically. (§2)",
  },
  {
    title: "NOT FINANCIAL ADVICE",
    body: "Every signal is informational analysis, not a guarantee of outcome or profit. Do your own research.",
  },
];

/**
 * Static, dated, cited — not a live query. discovery.scan.complete (the
 * event this is drawn from) is a structured log line, not a persisted
 * table row, so there is nothing to query for a live figure. This is the
 * real measured production rate at MAX_BLOCKS_PER_RUN=500 (05 §MAX_BLOCKS_PER_RUN,
 * packages/config/src/env.ts), 305ms/block, from docs/decisions/0011
 * (2026-09-09) — re-verify and update this constant if that rate changes.
 */
const SCAN_LATENCY = {
  blocks: 500,
  seconds: Math.round((500 * 305) / 1000),
  measuredDate: "2026-09-09",
};

/**
 * Per docs/decisions/0006-risk-and-token-page-unknowns.md and the
 * RiskAssessment model's own doc comment: of the 6 nominal risk
 * dimensions, contractRisk/deployerRisk/concentrationRisk are actually
 * computed from on-chain data; liquidityRisk and socialRisk stay UNKNOWN
 * permanently by design; linkRisk is partial. Claiming "6 evaluated"
 * would overstate this to anyone who checks a RiskAssessment row
 * directly — "3 of 6" is the honest figure.
 */
const RISK_DIMENSIONS_EVALUATED = 3;
const RISK_DIMENSIONS_TOTAL = 6;

// These are capability stats, not real-time state ("These are not
// real-time numbers" — the whole point of moving them off a live
// per-request Frankfurt round-trip). Cached for 60s via unstable_cache,
// which persists its entries as JSON — Date and BigInt (Prisma's type
// for the bigint block-count columns) aren't JSON-serializable, so the
// cached function returns a plain-string DTO and the caller reconstructs
// real Date/BigInt values immediately after, keeping every downstream
// line of this component (the totalBlocksScanned reduce, chainToken,
// formatMonthYear, formatAge, isFresh) working against the exact same
// types it always has.
interface CachedCheckpoint {
  chain: string;
  lastBlockNumber: string;
  totalBlocksScanned: string;
  lastRunAt: string | null;
  createdAt: string;
}

const getCachedCheckpoints = unstable_cache(
  async (): Promise<CachedCheckpoint[]> => {
    const checkpoints = await withDbRetry("LandingPage.checkpoints", () =>
      prisma.ingestionCheckpoint.findMany({ orderBy: { updatedAt: "desc" } }),
    );
    return checkpoints.map((c) => ({
      chain: c.chain,
      lastBlockNumber: c.lastBlockNumber.toString(),
      totalBlocksScanned: c.totalBlocksScanned.toString(),
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    }));
  },
  ["landing-checkpoints"],
  { revalidate: 60 },
);

async function fetchCheckpoints() {
  const cached = await getCachedCheckpoints();
  return cached.map((c) => ({
    chain: c.chain,
    lastBlockNumber: BigInt(c.lastBlockNumber),
    totalBlocksScanned: BigInt(c.totalBlocksScanned),
    lastRunAt: c.lastRunAt ? new Date(c.lastRunAt) : null,
    createdAt: new Date(c.createdAt),
  }));
}

const getCachedContractCount = unstable_cache(
  () => withDbRetry("LandingPage.contractCount", () => prisma.contract.count()),
  ["landing-contract-count"],
  { revalidate: 60 },
);

function fetchContractCount() {
  return getCachedContractCount();
}

export default async function LandingPage() {
  // Two independent queries, each allowed to fail on its own — a blip on
  // one must not take the other's real number down with it. Not the
  // page's reason for existing (that's just being reachable), so a
  // failure here degrades to "—" per affected stat rather than a 500.
  const [checkpointsResult, contractCountResult] = await Promise.allSettled([
    fetchCheckpoints(),
    fetchContractCount(),
  ]);
  const checkpointsAvailable = checkpointsResult.status === "fulfilled";
  const checkpoints = checkpointsResult.status === "fulfilled" ? checkpointsResult.value : [];
  const contractCount =
    contractCountResult.status === "fulfilled" ? contractCountResult.value : undefined;

  const primary = checkpoints[0] ?? null;
  // Sum across every watched chain, not just the most-recently-scanned
  // one — a genuine running total (checkpoint.ts's advanceCheckpoint),
  // never reconstructed from lastBlockNumber deltas (see that file's doc
  // comment on why that would overstate the real count). undefined (not
  // 0) when checkpoints itself failed to load — 0 would claim a real
  // count of zero rather than "we don't know right now."
  const totalBlocksScanned = checkpointsAvailable
    ? checkpoints.reduce((sum, c) => sum + c.totalBlocksScanned, 0n)
    : undefined;
  // Earliest first-successful-run across every chain — the real "live
  // since" date, not a hardcoded string. Naturally omitted (via the
  // `checkpoints` default of []) when the query failed, same as the
  // genuinely-no-chains-yet case — either way there's nothing honest to
  // show, so the hero line just doesn't render.
  const earliestCheckpoint = checkpoints.reduce<(typeof checkpoints)[number] | null>(
    (earliest, c) => (earliest === null || c.createdAt < earliest.createdAt ? c : earliest),
    null,
  );

  return (
    <main>
      {/* ---------------- hero ---------------- */}
      <Section first className="mx-auto max-w-5xl px-4 pt-16 sm:px-6 sm:pt-24 lg:px-8">
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          Signal intelligence
          <br />
          for on-chain launches.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-xl text-lg">
          AlphaRadar watches for new contract deployments as they happen, scores them, and
          classifies their risk — before the crowd notices.
        </p>
        {earliestCheckpoint && (
          <p className="text-muted-foreground mt-4 text-sm">
            Live on {chainToken(earliestCheckpoint.chain).label} Chain since{" "}
            {formatMonthYear(earliestCheckpoint.createdAt)}.
          </p>
        )}
        <Link
          href="/opportunities"
          className="font-display bg-signal text-signal-foreground mt-8 inline-block rounded-lg px-6 py-3.5 text-sm font-bold tracking-wide hover:opacity-90"
        >
          VIEW OPPORTUNITIES →
        </Link>
      </Section>

      {/* ---------------- live stats — real capability metrics, nothing invented ---------------- */}
      <Section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <BracketHeader>LIVE</BracketHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="BLOCKS SCANNED">
            {totalBlocksScanned === undefined ? "—" : totalBlocksScanned.toLocaleString()}
          </StatTile>
          <StatTile label="CONTRACTS INSPECTED">
            {contractCount === undefined ? "—" : contractCount.toLocaleString()}
          </StatTile>
          <StatTile label="CHAIN HEIGHT">
            {primary ? `#${primary.lastBlockNumber.toString()}` : "—"}
          </StatTile>
          <StatTile
            label="SCAN LATENCY"
            hint={`Block-scan phase only, measured ${SCAN_LATENCY.measuredDate} — excludes verify/score/alert`}
          >
            ~{SCAN_LATENCY.blocks} blocks / {SCAN_LATENCY.seconds}s
          </StatTile>
          <StatTile
            label="RISK DIMENSIONS"
            hint="Contract, deployer, concentration — liquidity and social stay UNKNOWN by design"
          >
            {RISK_DIMENSIONS_EVALUATED} of {RISK_DIMENSIONS_TOTAL}
          </StatTile>
        </div>
        <p className={`text-muted-foreground mt-3 ${BODY_TEXT}`}>
          Last scan:{" "}
          {!checkpointsAvailable ? (
            "unavailable right now"
          ) : primary?.lastRunAt ? (
            <span className="inline-flex items-center gap-1.5">
              {formatAge(primary.lastRunAt)} ago
              <SignalDot fresh={isFresh(primary.lastRunAt, SCAN_FRESHNESS_THRESHOLD_MS)} />
            </span>
          ) : (
            "no scans yet"
          )}
          {" — "}
          detection is sampled, not exhaustive: each run covers only the most recent blocks
          (MAX_BLOCKS_PER_RUN), so a large gap between runs is permanently skipped rather than
          backfilled.
        </p>
      </Section>

      {/* ---------------- what it watches ---------------- */}
      <Section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <BracketHeader>WATCHING</BracketHeader>
        <div className="flex flex-wrap gap-2 pb-2">
          {!checkpointsAvailable ? (
            <p className="text-muted-foreground text-sm">Chain status unavailable right now.</p>
          ) : checkpoints.length === 0 ? (
            <p className="text-muted-foreground text-sm">No chains configured yet.</p>
          ) : (
            checkpoints.map((checkpoint) => (
              <ChainBadge
                key={checkpoint.chain}
                chain={checkpoint.chain}
                className="px-2.5 py-1 text-xs"
              />
            ))
          )}
        </div>
      </Section>

      {/* ---------------- how it works — the real pipeline, in order. Equal-height
           cards fall out of the grid's own row-track sizing (every cell in a grid
           row shares the tallest cell's height by default) — no flex/stretch
           nesting needed, and no connector arrows to keep aligned across that
           nesting. Text stays top-aligned (the block default). ---------------- */}
      <Section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <BracketHeader>HOW IT WORKS</BracketHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.title} className="border-border bg-card rounded-lg border p-4">
              <span className={`text-muted-foreground font-mono ${LABEL_TEXT}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="font-display mt-1 text-base font-bold tracking-wide">{step.title}</h2>
              <p className={`text-muted-foreground mt-2 ${BODY_TEXT}`}>{step.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------- what it explicitly does not do ---------------- */}
      <Section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
        <BracketHeader>WHAT IT DOES NOT DO</BracketHeader>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {BOUNDARIES.map((boundary) => (
            <div key={boundary.title} className="flex gap-3">
              <X className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <h2 className={`font-display font-bold tracking-wide ${LABEL_TEXT}`}>
                  {boundary.title}
                </h2>
                <p className={`text-muted-foreground mt-1 ${BODY_TEXT}`}>{boundary.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}

function StatTile({
  label,
  hint,
  children,
}: {
  label: string;
  /** Shown as a title-attribute tooltip and to screen readers — extra honesty context that doesn't need to compete visually with the number. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4" title={hint}>
      <div className={`font-display text-muted-foreground font-bold tracking-wide ${LABEL_TEXT}`}>
        {label}
      </div>
      <div className="font-display mt-1.5 text-xl font-bold tabular-nums sm:text-2xl">
        {children}
      </div>
      {hint && <div className={`text-muted-foreground/70 mt-1 ${LABEL_TEXT}`}>{hint}</div>}
    </div>
  );
}
