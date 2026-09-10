import { cn } from "@/lib/utils";
import { SECTION_GAP } from "@/lib/spacing";

/**
 * Applies the shared section-to-section spacing (lib/spacing.ts) so no
 * individual section has to remember the value or accidentally zero it
 * out. `first` opts a page's opening section (a hero) out of the top
 * gap — it supplies its own opening space via padding instead.
 */
export function Section({
  first,
  className,
  children,
}: {
  first?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={cn(!first && SECTION_GAP, className)}>{children}</section>;
}
