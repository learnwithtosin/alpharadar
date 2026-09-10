import type { Prisma } from "@alpharadar/database";

/**
 * Opportunity.scoreInputs is stored as arbitrary JSONB — score.ts's own
 * doc comment says the point is "any score can be explained and
 * reproduced later, even after the weights change." A renderer that
 * hardcoded today's exact field list would go stale the moment
 * scoringVersion changes; this walks whatever JSON is actually there.
 */
export function JsonRows({ value }: { value: Prisma.JsonValue }) {
  if (value === null) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (typeof value !== "object") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return <span>[{value.map((entry, i) => (i === 0 ? "" : ", ") + String(entry)).join("")}]</span>;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">(empty)</span>;
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="text-foreground">
            {entryValue === null || typeof entryValue !== "object" ? (
              String(entryValue)
            ) : (
              <JsonRows value={entryValue} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
