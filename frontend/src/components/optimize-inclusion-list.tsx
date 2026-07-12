import type { RuleInclusionEntry } from "@/lib/api-optimization-types";

/**
 * How often each rule stayed active among the top eligible candidates. A rule
 * kept by nearly every strong candidate earns its place; one appearing in a
 * single lucky candidate is weak evidence.
 */
export function OptimizeInclusionList({ entries }: { entries: RuleInclusionEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  const topCount = entries[0].topCount;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1">
        {entries.map((entry) => {
          const fraction = entry.topCount > 0 ? entry.includedCount / entry.topCount : 0;
          return (
            <div key={entry.ruleId} className="flex items-center gap-3">
              <span className="text-muted-foreground w-52 shrink-0 truncate text-xs" title={entry.summary}>
                {entry.summary}
              </span>
              <div className="bg-border/60 h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(fraction * 100)}%`,
                    backgroundColor: "var(--viz-candidate)",
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                {entry.includedCount}/{entry.topCount}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground px-1 text-xs">
        Share of the top {topCount} eligible candidate{topCount === 1 ? "" : "s"} that keep each
        rule active. A rule kept only once is weak evidence.
      </p>
    </div>
  );
}
