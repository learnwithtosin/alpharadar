import { cn } from "@/lib/utils";

/**
 * The only continuously-moving thing in the app, and only conditionally
 * even then: `fresh` decides `.is-fresh` (globals.css's signal-pulse
 * keyframes), so a stale contact renders this exact same markup with no
 * animation class at all — not a paused/dimmed animation, genuinely none.
 */
export function SignalDot({
  fresh,
  className,
  title,
}: {
  fresh: boolean;
  className?: string;
  /** Only meaningful when the dot appears with no adjacent label text (the mobile header). */
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        fresh
          ? "is-fresh bg-signal shadow-[0_0_6px_hsl(var(--signal)/0.8)]"
          : "bg-muted-foreground/40",
        className,
      )}
      title={title}
      aria-hidden="true"
    />
  );
}
