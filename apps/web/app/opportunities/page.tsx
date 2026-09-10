import Link from "next/link";
import { prisma } from "@alpharadar/database";
import { ChainBadge, RiskBadge, UrgencyBadge } from "@/components/domain-badges";
import { SignalDot } from "@/components/signal-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { scoreClassName } from "@/lib/domain-colors";
import { formatAge, FRESHNESS_THRESHOLD_MS, isFresh } from "@/lib/format";

// Detection never stops (a 5-minute cron) and there's no session/auth to
// cache around — always the current real state, not a stale build-time
// snapshot. See docs/decisions/0013-web-opportunities-pages.md.
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const opportunities = await prisma.opportunity.findMany({
    // isTestData rows are dev-tooling fixtures (apps/pipeline/src/dev/
    // seed-test-opportunity.ts) — never a real detection. Excluded from
    // this listing; still reachable directly at /opportunities/[id] (the
    // Telegram alert for one links straight there).
    where: { isTestData: false },
    orderBy: { detectedAt: "desc" },
    include: {
      project: true,
      riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <h1 className="font-display text-muted-foreground mb-8 text-xs font-bold tracking-[0.14em]">
        CONTACTS
      </h1>

      {opportunities.length === 0 ? (
        <p className="text-muted-foreground text-sm">No opportunities detected yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="font-display">
              <TableHead>Project</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Signal</TableHead>
              <TableHead>Threat</TableHead>
              <TableHead>Urgency</TableHead>
              <TableHead className="text-right">Contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opportunities.map((opportunity) => {
              const overallRisk = opportunity.riskAssessments[0]?.overallRisk ?? "UNKNOWN";
              const fresh = isFresh(opportunity.detectedAt, FRESHNESS_THRESHOLD_MS);
              return (
                <TableRow key={opportunity.id}>
                  <TableCell className="max-w-[14rem] truncate font-medium">
                    <Link href={`/opportunities/${opportunity.id}`} className="hover:underline">
                      {opportunity.project.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ChainBadge chain={opportunity.chain} />
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {opportunity.type}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {opportunity.score === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={`font-display font-bold ${scoreClassName(opportunity.score)}`}
                      >
                        {opportunity.score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={overallRisk} />
                  </TableCell>
                  <TableCell>
                    {opportunity.urgency ? (
                      <UrgencyBadge urgency={opportunity.urgency} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-muted-foreground inline-flex items-center justify-end gap-1.5 font-mono text-xs">
                      {formatAge(opportunity.detectedAt)}
                      <SignalDot fresh={fresh} />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
