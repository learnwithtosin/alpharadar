/**
 * Section divider styled as an instrument-panel label, not a heading —
 * neutral-colored (docs/decisions/0014: the signal accent is reserved
 * for the score/CTA/LOW-risk, not spread across chrome like this used
 * to be).
 */
export function BracketHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-muted-foreground mb-4 mt-12 flex items-center gap-3 text-xs font-bold tracking-[0.14em] first:mt-0">
      {children}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}
