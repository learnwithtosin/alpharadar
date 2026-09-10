import Link from "next/link";
import { unstable_cache } from "next/cache";
import type { OpportunityStatus, OpportunityType, RiskLevel, Urgency } from "@alpharadar/types";
import { prisma, withDbRetry } from "@alpharadar/database";
import { BracketHeader } from "@/components/bracket-header";
import { ChainBadge, RiskBadge, UrgencyBadge } from "@/components/domain-badges";
import { Section } from "@/components/section";
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
import { formatAbsolute, formatAge, FRESHNESS_THRESHOLD_MS, isFresh } from "@/lib/format";

// Detection never stops (a 5-minute cron), but a list that's up to 60s
// stale is fine against a 5-minute cadence — see the caching comment
// below. What no longer holds from docs/decisions/0013 is "always the
// current real state, not a stale build-time snapshot": that reasoning
// was about avoiding a *build-time* snapshot (this route stays
// per-request dynamic, `force-dynamic`), not about ruling out a bounded
// request-time cache.
export const dynamic = "force-dynamic";

/**
 * "Actionable" for this page — distinct from opportunity-dedup.ts's
 * OPEN_STATUSES, which answers a different question (should a new
 * signal be blocked from creating a duplicate?). REJECTED counts as
 * "open" there deliberately, so a later attempt can still supersede a
 * rejected one. Here the question is "should a user consider acting on
 * this?", and REJECTED fails that on its own terms — the pipeline
 * decided it doesn't qualify, so it's grouped with the closed statuses
 * below, not the live ones.
 *
 * Only DETECTED is ever actually set by the real pipeline today
 * (opportunity-dedup.ts's findOrCreateOpportunity, on create — nothing
 * currently transitions an opportunity's status afterward; resolve.ts's
 * two `status: "ACTIVE"` writes are Project.status, a different field).
 * VERIFYING/ACTIVE/UPCOMING exist in the schema for whenever a real
 * transition starts setting them, and are included here so this filter
 * does the right thing the moment they do. Concretely: today this makes
 * the live/closed split a no-op against real data — every real row is
 * DETECTED, so every real row is "live." That's disclosed, not hidden:
 * the schema doesn't currently support telling a genuinely-closed mint
 * apart from an open one any other way (`endsAt`/`startsAt` are never
 * set either — score.ts's own comment: "Slice 1 never sets
 * startsAt/endsAt" — so age-based inference would be an invented rule,
 * not a real signal).
 */
const ACTIONABLE_STATUSES: readonly OpportunityStatus[] = [
  "DETECTED",
  "VERIFYING",
  "ACTIVE",
  "UPCOMING",
];

function isActionable(status: OpportunityStatus): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

/**
 * A stored opportunity's list-row fields barely change after scoring, and
 * the pipeline runs every 5 minutes — a 60s-stale list is indistinguishable
 * from a live one in practice, and every request previously paid a full
 * Frankfurt round trip (the actual reason this page was slow, unrelated to
 * AppHeader) to relearn the same rows. `unstable_cache` persists entries as
 * JSON, so `detectedAt` (a `Date`) is flattened to an ISO string here and
 * reconstructed by the caller — same pattern as the landing page's
 * checkpoints (docs/decisions/0017).
 *
 * Retry and the error boundary both still apply: a cache miss runs the
 * real, retried query, and an error (once retries are exhausted) still
 * throws through to error.tsx uncaught — caching adds a layer in front of
 * that path, it doesn't change what happens when the path is actually hit.
 */
interface CachedOpportunityRow {
  id: string;
  projectName: string;
  chain: string | null;
  type: OpportunityType;
  status: OpportunityStatus;
  score: number | null;
  overallRisk: RiskLevel;
  urgency: Urgency | null;
  detectedAt: string;
}

/**
 * `unstable_cache` already does the resilient thing on a failed
 * revalidation — confirmed by reading Next.js's own implementation
 * (server/web/spec-extension/unstable-cache.js), not assumed: when a
 * stale entry's background revalidation throws, Next catches it
 * internally, logs it, and resolves with the *previous* cached value
 * instead of propagating the error — a request never sees that failure,
 * cached or not. So this file doesn't need its own fallback wrapper.
 *
 * What that mechanism doesn't give the UI is any signal that a fallback
 * just happened — a revalidation-failure fallback and an ordinary
 * within-window cache hit are indistinguishable from the outside. Since
 * a live pooler outage can leave the "60s-stale" list serving data far
 * older than 60s for as long as the outage lasts, `fetchedAt` is tracked
 * explicitly (set at the moment of the last *successful* fetch, inside
 * the cached function) so the page can say so honestly rather than
 * silently presenting old data as current.
 */
interface CachedOpportunities {
  fetchedAt: string;
  rows: CachedOpportunityRow[];
}

const getCachedOpportunities = unstable_cache(
  async (): Promise<CachedOpportunities> => {
    const opportunities = await withDbRetry(
      "OpportunitiesPage.opportunities",
      () =>
        prisma.opportunity.findMany({
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
        }),
      "request",
    );
    return {
      fetchedAt: new Date().toISOString(),
      rows: opportunities.map((o) => ({
        id: o.id,
        projectName: o.project.name,
        chain: o.chain,
        type: o.type,
        status: o.status,
        score: o.score,
        overallRisk: o.riskAssessments[0]?.overallRisk ?? "UNKNOWN",
        urgency: o.urgency,
        detectedAt: o.detectedAt.toISOString(),
      })),
    };
  },
  ["opportunities-list"],
  { revalidate: 60 },
);

/**
 * 60s is the *target* revalidation window, not a guarantee — during a
 * live outage, every revalidation attempt fails and Next keeps serving
 * the last successful fetch (see above) for as long as that lasts. Well
 * beyond the 60s target (3x, with margin for a request landing just
 * before a revalidation would have fired) is treated as "this is
 * probably a failure fallback, not ordinary staleness," and disclosed
 * rather than presented as current.
 */
const STALE_NOTE_THRESHOLD_MS = 180_000;

type OpportunityRow = Omit<CachedOpportunityRow, "detectedAt"> & { detectedAt: Date };

/** Highest-scoring first, unscored last — "what can I act on now," not "what showed up most recently." */
function compareLive(a: OpportunityRow, b: OpportunityRow): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  return b.detectedAt.getTime() - a.detectedAt.getTime();
}

export default async function OpportunitiesPage() {
  const cached = await getCachedOpportunities();
  const fetchedAt = new Date(cached.fetchedAt);
  const isStale = Date.now() - fetchedAt.getTime() > STALE_NOTE_THRESHOLD_MS;
  const opportunities: OpportunityRow[] = cached.rows.map((o) => ({
    ...o,
    detectedAt: new Date(o.detectedAt),
  }));

  const live = opportunities.filter((o) => isActionable(o.status)).sort(compareLive);
  const closed = opportunities
    .filter((o) => !isActionable(o.status))
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-muted-foreground text-xs font-bold tracking-[0.14em]">
          OPPORTUNITIES
        </h1>
        <p className="text-muted-foreground text-xs">
          {live.length.toLocaleString()} live opportunit{live.length === 1 ? "y" : "ies"}
          {closed.length > 0
            ? ` · ${closed.length.toLocaleString()} closed opportunit${closed.length === 1 ? "y" : "ies"}`
            : ""}
          {isStale && (
            <span className="text-warn ml-2" title={formatAbsolute(fetchedAt)}>
              — data delayed, last refreshed {formatAge(fetchedAt)} ago
            </span>
          )}
        </p>
      </div>

      {opportunities.length === 0 ? (
        <p className="text-muted-foreground text-sm">No opportunities detected yet.</p>
      ) : (
        <>
          {live.length === 0 ? (
            <p className="text-muted-foreground text-sm">No live opportunities right now.</p>
          ) : (
            <OpportunityTable rows={live} />
          )}

          {closed.length > 0 && (
            <Section>
              <BracketHeader>CLOSED</BracketHeader>
              <OpportunityTable rows={closed} closed />
            </Section>
          )}
        </>
      )}
    </main>
  );
}

/** Closed rows reuse the exact same table shape as live ones, dimmed (opacity-60) so a closed mint reads as past rather than actionable — never hidden, never left looking identical to a live one. */
function OpportunityTable({ rows, closed }: { rows: OpportunityRow[]; closed?: boolean }) {
  return (
    <Table className={closed ? "opacity-60" : undefined}>
      <TableHeader>
        <TableRow className="font-display">
          <TableHead>Project</TableHead>
          <TableHead>Chain</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Risk</TableHead>
          <TableHead>{closed ? "Status" : "Urgency"}</TableHead>
          <TableHead className="text-right">Detected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((opportunity) => {
          const fresh = !closed && isFresh(opportunity.detectedAt, FRESHNESS_THRESHOLD_MS);
          return (
            <TableRow key={opportunity.id}>
              <TableCell className="max-w-[14rem] truncate font-medium">
                <Link href={`/opportunities/${opportunity.id}`} className="hover:underline">
                  {opportunity.projectName}
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
                  <span className={`font-display font-bold ${scoreClassName(opportunity.score)}`}>
                    {opportunity.score}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <RiskBadge risk={opportunity.overallRisk} />
              </TableCell>
              <TableCell>
                {closed ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    {opportunity.status}
                  </span>
                ) : opportunity.urgency ? (
                  <UrgencyBadge urgency={opportunity.urgency} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground inline-flex items-center justify-end gap-1.5 font-mono text-xs">
                  {formatAge(opportunity.detectedAt)}
                  {!closed && <SignalDot fresh={fresh} />}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
