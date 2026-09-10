import Link from "next/link";
import { notFound } from "next/navigation";
import type { RiskLevel } from "@alpharadar/types";
import { prisma } from "@alpharadar/database";
import { BracketHeader } from "@/components/bracket-header";
import { ChainBadge, RiskBadge, UrgencyBadge } from "@/components/domain-badges";
import { CopyAddressButton } from "@/components/copy-address-button";
import { JsonRows } from "@/components/json-rows";
import { SignalDot } from "@/components/signal-dot";
import { scoreClassName, scoreGlowClassName } from "@/lib/domain-colors";
import { formatAbsolute, formatAge, FRESHNESS_THRESHOLD_MS, isFresh } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RISK_DIMENSIONS: { key: keyof RiskDimensions; label: string }[] = [
  { key: "contractRisk", label: "Contract" },
  { key: "concentrationRisk", label: "Concentration" },
  { key: "deployerRisk", label: "Deployer" },
  { key: "liquidityRisk", label: "Liquidity" },
  { key: "socialRisk", label: "Social" },
  { key: "linkRisk", label: "Link" },
];

interface RiskDimensions {
  contractRisk: RiskLevel;
  concentrationRisk: RiskLevel;
  deployerRisk: RiskLevel;
  liquidityRisk: RiskLevel;
  socialRisk: RiskLevel;
  linkRisk: RiskLevel;
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const opportunity = await prisma.opportunity.findUnique({
    where: { id },
    include: {
      project: true,
      riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
      evidence: { include: { source: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!opportunity) {
    notFound();
  }

  const contract =
    opportunity.chain && opportunity.contractAddress
      ? await prisma.contract.findUnique({
          where: {
            chain_address: { chain: opportunity.chain, address: opportunity.contractAddress },
          },
        })
      : null;

  const risk = opportunity.riskAssessments[0] ?? null;
  const overallRisk: RiskLevel = risk?.overallRisk ?? "UNKNOWN";
  const fresh = isFresh(opportunity.detectedAt, FRESHNESS_THRESHOLD_MS);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <Link
        href="/opportunities"
        className="font-display text-muted-foreground hover:text-foreground text-xs font-bold tracking-wide"
      >
        ‹ CONTACTS
      </Link>

      <div className="mt-6 lg:grid lg:grid-cols-[1.3fr_1fr] lg:items-start lg:gap-10">
        {/* ---------------- hero: score, threat class, why — the five-second test ---------------- */}
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <ChainBadge chain={opportunity.chain} />
            <span className="text-muted-foreground font-mono text-xs">
              {opportunity.type} · {opportunity.actionProfile}
            </span>
          </div>
          <h1 className="mb-10 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            {opportunity.project.name}
          </h1>

          <div className="relative">
            {opportunity.score !== null && (
              <div
                className={cn(
                  "absolute -left-8 -top-8 h-56 w-56 rounded-full opacity-[0.16] blur-3xl",
                  scoreGlowClassName(opportunity.score),
                )}
                aria-hidden="true"
              />
            )}
            <div className="relative">
              <div className="font-display text-muted-foreground mb-1.5 text-xs font-bold tracking-[0.16em]">
                SIGNAL STRENGTH
              </div>
              <div className="flex items-end gap-6">
                {opportunity.score === null ? (
                  <div className="font-display text-muted-foreground text-6xl font-bold sm:text-7xl">
                    —
                  </div>
                ) : (
                  <div
                    className={cn(
                      "font-display animate-score-in text-[5.5rem] font-bold leading-none tracking-tight sm:text-8xl",
                      scoreClassName(opportunity.score),
                    )}
                  >
                    {opportunity.score}
                    <span className="text-muted-foreground ml-1 text-[0.22em] font-medium">
                      /100
                    </span>
                  </div>
                )}
                {opportunity.score !== null && <SignalBars score={opportunity.score} />}
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <RiskBadge risk={overallRisk} className="px-3 py-1.5 text-sm" />
            {opportunity.urgency && (
              <UrgencyBadge urgency={opportunity.urgency} className="px-3 py-1.5 text-sm" />
            )}
          </div>

          {risk && risk.reasons.length > 0 && (
            <ul className="mt-6 space-y-1.5 text-base">
              {risk.reasons.slice(0, 3).map((reason, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">▸</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="text-muted-foreground mt-8 flex items-center gap-2 font-mono text-xs">
            ACQUIRED {formatAge(opportunity.detectedAt)} ago (
            {formatAbsolute(opportunity.detectedAt)})
            <SignalDot fresh={fresh} />
          </div>

          {opportunity.officialActionUrl && (
            <a
              href={opportunity.officialActionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display bg-signal text-signal-foreground mt-8 block rounded-lg px-6 py-3.5 text-center text-sm font-bold tracking-wide hover:opacity-90"
            >
              OFFICIAL ACTION LINK ↗
            </a>
          )}
        </div>

        {/* ---------------- contract — beside the hero at lg+, below it otherwise ---------------- */}
        <div className="mt-12 lg:mt-0">
          <BracketHeader>CONTRACT</BracketHeader>
          <div className="border-border bg-card rounded-lg border p-5 sm:p-6">
            {opportunity.contractAddress ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <code className="break-all font-mono text-sm leading-relaxed">
                    {opportunity.contractAddress}
                  </code>
                  <CopyAddressButton address={opportunity.contractAddress} />
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                  <Field label="CHAIN" value={opportunity.chain ?? "Unknown"} />
                  <Field label="TYPE" value={contract?.contractType ?? "Unknown"} />
                  <Field
                    label="VERIFIED"
                    value={contract ? (contract.verified ? "Verified" : "Not verified") : "Unknown"}
                  />
                  <Field label="DEPLOYER" value={contract?.deployerAddress ?? "Unknown"} mono />
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                This opportunity has no associated contract address.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- risk classification — 2 cols mobile, 3 at md+ ---------------- */}
      <BracketHeader>RISK CLASSIFICATION</BracketHeader>
      <div className="border-border bg-card rounded-lg border p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {RISK_DIMENSIONS.map(({ key, label }) => (
            <RiskTile key={key} label={label} value={risk ? (risk[key] as RiskLevel) : "UNKNOWN"} />
          ))}
        </div>
      </div>

      {/* ---------------- score inputs + evidence share a row at lg+ ---------------- */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        <div>
          {opportunity.scoreInputs !== null && (
            <>
              <BracketHeader>
                SCORE INPUTS{opportunity.scoringVersion ? ` (${opportunity.scoringVersion})` : ""}
              </BracketHeader>
              <div className="border-border bg-card rounded-lg border p-5 font-mono sm:p-6">
                <JsonRows value={opportunity.scoreInputs} />
              </div>
            </>
          )}
        </div>

        <div>
          <BracketHeader>EVIDENCE</BracketHeader>
          <div className="border-border bg-card rounded-lg border p-5 sm:p-6">
            {opportunity.evidence.length === 0 ? (
              <p className="text-muted-foreground text-sm">No evidence recorded.</p>
            ) : (
              <ul className="space-y-4">
                {opportunity.evidence.map((item) => (
                  <li
                    key={item.id}
                    className="border-border border-b pb-4 text-sm last:border-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>{item.claim}</span>
                      <span className="font-display border-border text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-bold">
                        {item.evidenceType}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">
                      {item.source.type}
                      {item.source.publisher ? ` · ${item.source.publisher}` : ""} ·{" "}
                      <a
                        href={item.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {item.source.url}
                      </a>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function SignalBars({ score }: { score: number }) {
  const filled = Math.min(5, Math.ceil(score / 20));
  const tierClass = scoreClassName(score).replace("text-", "bg-");
  return (
    <div className="mb-2 flex h-12 items-end gap-1.5" aria-hidden="true">
      {[28, 46, 64, 82, 100].map((height, i) => (
        <span
          key={height}
          style={{ height: `${height}%` }}
          className={cn("w-2.5 rounded-sm", i < filled ? tierClass : "bg-border")}
        />
      ))}
    </div>
  );
}

function RiskTile({ label, value }: { label: string; value: RiskLevel }) {
  const known = value !== "UNKNOWN";
  const colorClass =
    value === "LOW"
      ? "border-signal/45 bg-signal/10 text-signal"
      : value === "MEDIUM"
        ? "border-warn/45 bg-warn/10 text-warn"
        : value === "HIGH" || value === "CRITICAL"
          ? "border-destructive/45 bg-destructive/10 text-destructive"
          : "";

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2.5",
        known ? colorClass : "border-unknown/40 border-dashed opacity-50",
      )}
    >
      <span className="font-display text-muted-foreground text-xs">{label}</span>
      <span className={cn("font-display text-xs font-bold", known ? "" : "text-unknown")}>
        {known ? value : "UNK"}
      </span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-display text-muted-foreground text-[0.65rem] font-bold tracking-wide">
        {label}
      </dt>
      <dd className={mono ? "mt-0.5 break-all font-mono text-xs" : "mt-0.5 text-sm"}>{value}</dd>
    </div>
  );
}
