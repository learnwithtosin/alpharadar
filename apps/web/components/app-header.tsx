import { Suspense } from "react";
import Link from "next/link";
import { prisma, withDbRetry } from "@alpharadar/database";
import { SignalDot } from "@/components/signal-dot";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatAge, isFresh, SCAN_FRESHNESS_THRESHOLD_MS } from "@/lib/format";

/**
 * The only nav in the app — wordmark home, one link to Opportunities.
 * Kept to exactly that on purpose (the ask was minimal, not a menu).
 * Labeled "Opportunities," not "Contacts" — the radar vocabulary works
 * as a visual theme but fails as navigation: someone arriving cold reads
 * "Contacts" as a contact-us page, and it contradicted the /opportunities
 * route it actually pointed to.
 *
 * This is a global, synchronous shell — rendered on every page, and it
 * must never wait on a database round-trip (Frankfurt) before the shell
 * itself can paint. The scan indicator is the one piece of this header
 * backed by a query; it's isolated in its own async `ScanIndicator`
 * component below and streamed in via Suspense, so the nav and theme
 * toggle are part of the initial HTML response regardless of how long —
 * or whether — that query (plus its bounded retries) takes. Previously
 * AppHeader itself was `async` and awaited the checkpoint inline, which
 * meant the checkpoint's query latency (and every retry delay on a
 * connection blip) was on the critical path for every single page's
 * time-to-first-byte, not just decoration once painted.
 */
export function AppHeader() {
  return (
    <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <nav className="flex items-center gap-4 sm:gap-6">
        <Link
          href="/"
          className="font-display text-foreground hover:text-signal text-xs font-bold tracking-widest"
        >
          ALPHARADAR
        </Link>
        <Link
          href="/opportunities"
          className="font-display text-muted-foreground hover:text-foreground text-xs font-bold tracking-wide"
        >
          OPPORTUNITIES
        </Link>
      </nav>
      <div className="flex items-center gap-3 sm:gap-4">
        <Suspense fallback={<ScanIndicatorSkeleton />}>
          <ScanIndicator />
        </Suspense>
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * The scan indicator reads IngestionCheckpoint.lastRunAt directly — this
 * is the only "live" chrome in the app, and it's real: the dot pulses
 * only when the last pipeline run genuinely was recent (within
 * SCAN_FRESHNESS_THRESHOLD_MS), not on a timer. A run that hasn't
 * happened in a while shows a static dot and the real elapsed time, not
 * a disguised or hidden staleness — the same "unknown/stale stays
 * visible" instinct as the risk grid, applied to the pipeline's own
 * health. At 380px the full "SCAN Xm ago" text gives way to just the
 * dot (sm: and up restores the text) — three header elements plus a
 * timestamp string is too much for a 380px row otherwise.
 *
 * Decorative, not the page's reason for existing — on failure it
 * degrades to absent (the Suspense boundary above already keeps it from
 * ever blocking the shell; this is the belt-and-suspenders case where
 * the query itself, not just its latency, fails outright).
 */
async function ScanIndicator() {
  // undefined = the read failed (omit the indicator entirely); null = the
  // read succeeded but no checkpoint row exists yet (a real "no scans
  // yet" state) — these must stay distinguishable, or a DB blip would
  // silently masquerade as "the pipeline has never run."
  let checkpoint: Awaited<ReturnType<typeof fetchCheckpoint>> | undefined;
  try {
    checkpoint = await fetchCheckpoint();
  } catch {
    // Degrade, don't crash.
  }
  if (checkpoint === undefined) {
    return null;
  }
  const scanFresh = checkpoint?.lastRunAt
    ? isFresh(checkpoint.lastRunAt, SCAN_FRESHNESS_THRESHOLD_MS)
    : false;

  return (
    <>
      <span
        className="font-display text-muted-foreground hidden items-center gap-2 text-[0.65rem] tracking-wider sm:flex"
        title={checkpoint?.lastRunAt ? undefined : "The pipeline has not run yet"}
      >
        {checkpoint?.lastRunAt ? `SCAN ${formatAge(checkpoint.lastRunAt)} ago` : "NO SCANS YET"}
        <SignalDot fresh={scanFresh} />
      </span>
      {/* Mobile-only compact form of the same indicator. */}
      <SignalDot
        fresh={scanFresh}
        className="sm:hidden"
        title={
          checkpoint?.lastRunAt
            ? `Last scan ${formatAge(checkpoint.lastRunAt)} ago`
            : "No scans yet"
        }
      />
    </>
  );
}

/**
 * Matches ScanIndicator's shape at both breakpoints (a text line + dot
 * on sm:+, just a dot below it) so nothing shifts size when the real
 * content streams in — pulseless and muted, it reads as "loading," not
 * as real data.
 */
function ScanIndicatorSkeleton() {
  return (
    <>
      <span className="hidden items-center gap-2 sm:flex" aria-hidden="true">
        <span className="bg-muted-foreground/20 h-2.5 w-16 animate-pulse rounded-sm" />
        <span className="bg-muted-foreground/20 h-1.5 w-1.5 animate-pulse rounded-full" />
      </span>
      <span
        className="bg-muted-foreground/20 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full sm:hidden"
        aria-hidden="true"
      />
    </>
  );
}

function fetchCheckpoint() {
  return withDbRetry("AppHeader.checkpoint", () =>
    prisma.ingestionCheckpoint.findFirst({ orderBy: { updatedAt: "desc" } }),
  );
}
