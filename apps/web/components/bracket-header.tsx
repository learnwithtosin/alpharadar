import { LABEL_GAP } from "@/lib/spacing";
import { LABEL_TEXT } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Section divider styled as an instrument-panel label, not a heading —
 * neutral-colored (docs/decisions/0014: the signal accent is reserved
 * for the score/CTA/LOW-risk, not spread across chrome like this used
 * to be).
 *
 * Only owns the gap to its own content below (LABEL_GAP) — the gap
 * *above* the label is the enclosing `<Section>`'s job (lib/spacing.ts).
 * This used to carry its own `mt-12 first:mt-0`, which silently zeroed
 * out any time the label was the first child of its wrapper — true in
 * almost every real usage — leaving no gap above it at all.
 */
export function BracketHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "font-display text-muted-foreground flex items-center gap-3 font-bold tracking-[0.14em]",
        LABEL_TEXT,
        LABEL_GAP,
      )}
    >
      {children}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}
