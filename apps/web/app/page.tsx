import Link from "next/link";
import { prisma } from "@alpharadar/database";
import { BracketHeader } from "@/components/bracket-header";
import { ChainBadge } from "@/components/domain-badges";
import { SignalDot } from "@/components/signal-dot";
import { formatAge, SCAN_FRESHNESS_THRESHOLD_MS, isFresh } from "@/lib/format";

export const dynamic = "force-dynamic";

const CAPABILITIES = [
  {
    title: "DETECT",
    body: "Scans every new block for contract creation — NFT mints and ERC-20 launches — as they deploy, not after they trend.",
  },
  {
    title: "SCORE",
    body: "A deterministic 0-100 score from legitimacy, freshness, and on-chain signal — the exact inputs are stored with every score, so any result can be explained and reproduced.",
  },
  {
    title: "CLASSIFY RISK",
    body: "Contract, concentration, and deployer risk from what's actually verifiable on-chain. What isn't checked yet stays labeled UNKNOWN — never guessed.",
  },
  {
    title: "ALERT",
    body: "A risk veto blocks delivery outright above a threat threshold, regardless of score — the alert never overrides the classification.",
  },
];

export default async function LandingPage() {
  const [checkpoints, contractCount, opportunityCount] = await Promise.all([
    prisma.ingestionCheckpoint.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.contract.count(),
    prisma.opportunity.count({ where: { isTestData: false } }),
  ]);
  const primary = checkpoints[0] ?? null;

  return (
    <main>
      {/* ---------------- hero ---------------- */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          Signal intelligence
          <br />
          for on-chain launches.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-xl text-lg">
          AlphaRadar watches for new contract deployments as they happen, scores them, and
          classifies their risk — before the crowd notices.
        </p>
        <Link
          href="/opportunities"
          className="font-display bg-signal text-signal-foreground mt-8 inline-block rounded-lg px-6 py-3.5 text-sm font-bold tracking-wide hover:opacity-90"
        >
          VIEW CONTACTS →
        </Link>
      </section>

      {/* ---------------- live stats — real data only, nothing invented ---------------- */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <BracketHeader>LIVE</BracketHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="LAST SCAN">
            {primary?.lastRunAt ? (
              <span className="inline-flex items-center gap-2">
                {formatAge(primary.lastRunAt)} ago
                <SignalDot fresh={isFresh(primary.lastRunAt, SCAN_FRESHNESS_THRESHOLD_MS)} />
              </span>
            ) : (
              <span className="text-muted-foreground">No scans yet</span>
            )}
          </StatTile>
          <StatTile label="CHAIN HEIGHT">
            {primary ? `#${primary.lastBlockNumber.toString()}` : "—"}
          </StatTile>
          <StatTile label="CONTRACTS OBSERVED">{contractCount.toLocaleString()}</StatTile>
          <StatTile label="OPPORTUNITIES DETECTED">{opportunityCount.toLocaleString()}</StatTile>
        </div>
      </section>

      {/* ---------------- what it watches ---------------- */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <BracketHeader>WATCHING</BracketHeader>
        <div className="flex flex-wrap gap-2 pb-2">
          {checkpoints.length === 0 ? (
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
      </section>

      {/* ---------------- what it does ---------------- */}
      <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
        <BracketHeader>WHAT IT DOES</BracketHeader>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((capability) => (
            <div key={capability.title}>
              <h2 className="font-display text-signal text-sm font-bold tracking-wide">
                {capability.title}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {capability.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function StatTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="font-display text-muted-foreground text-[0.65rem] font-bold tracking-wide">
        {label}
      </div>
      <div className="font-display mt-1.5 text-xl font-bold tabular-nums sm:text-2xl">
        {children}
      </div>
    </div>
  );
}
