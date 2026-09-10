import Link from "next/link";
import { prisma } from "@alpharadar/database";
import { SignalDot } from "@/components/signal-dot";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatAge, isFresh, SCAN_FRESHNESS_THRESHOLD_MS } from "@/lib/format";

/**
 * The scan indicator reads IngestionCheckpoint.lastRunAt directly — this
 * is the only "live" chrome in the app, and it's real: the dot pulses
 * only when the last pipeline run genuinely was recent (within
 * SCAN_FRESHNESS_THRESHOLD_MS), not on a timer. A run that hasn't
 * happened in a while shows a static dot and the real elapsed time, not
 * a disguised or hidden staleness — the same "unknown/stale stays
 * visible" instinct as the risk grid, applied to the pipeline's own
 * health.
 */
export async function AppHeader() {
  const checkpoint = await prisma.ingestionCheckpoint.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
      <Link
        href="/"
        className="font-display text-muted-foreground text-xs font-bold tracking-widest"
      >
        ALPHARADAR
      </Link>
      <div className="flex items-center gap-4">
        <span className="font-display text-muted-foreground flex items-center gap-2 text-[0.65rem] tracking-wider">
          {checkpoint?.lastRunAt ? (
            <>
              SCAN {formatAge(checkpoint.lastRunAt)} ago
              <SignalDot fresh={isFresh(checkpoint.lastRunAt, SCAN_FRESHNESS_THRESHOLD_MS)} />
            </>
          ) : (
            <>
              NO SCANS YET
              <SignalDot fresh={false} />
            </>
          )}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
