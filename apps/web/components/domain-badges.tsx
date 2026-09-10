import type { RiskLevel, Urgency } from "@alpharadar/types";
import { Badge } from "@/components/ui/badge";
import { chainToken } from "@/lib/chain-tokens";
import { riskBadgeClassName, urgencyBadgeClassName } from "@/lib/domain-colors";
import { cn } from "@/lib/utils";

const TAG_BASE = "font-display text-xs font-bold tracking-wide";

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  return (
    <Badge variant="outline" className={cn(TAG_BASE, riskBadgeClassName(risk), className)}>
      {risk}
    </Badge>
  );
}

export function UrgencyBadge({ urgency, className }: { urgency: Urgency; className?: string }) {
  return (
    <Badge variant="outline" className={cn(TAG_BASE, urgencyBadgeClassName(urgency), className)}>
      {urgency}
    </Badge>
  );
}

/** Deliberately colorless — see chain-tokens.ts and docs/decisions/0014. */
export function ChainBadge({ chain, className }: { chain: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "font-display border-muted-foreground/30 text-muted-foreground inline-flex items-center rounded border px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider",
        className,
      )}
    >
      {chainToken(chain).label}
    </span>
  );
}
