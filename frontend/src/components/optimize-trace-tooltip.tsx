import type { CandidateDiffRow } from "@/lib/optimize-candidate-utils";
import type { TracePoint } from "@/lib/optimize-detail-utils";

const maxDiffRows = 6;

/** Trace-chart hover card: trial status plus what the candidate changed vs the baseline. */
export function OptimizeTraceTooltip({
  point,
  diff,
  left,
}: {
  point: TracePoint;
  diff: CandidateDiffRow[] | undefined;
  left: number;
}) {
  return (
    <div
      className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-56 rounded-md border p-2.5 text-xs shadow-md"
      style={{ top: 8, left }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Trial {point.trialIndex}</span>
        <span className="font-semibold">{point.score.toFixed(2)}</span>
      </div>
      <div className="text-muted-foreground mt-0.5">
        {point.status === "pruned"
          ? "Pruned by successive halving"
          : point.eligible
            ? "Eligible"
            : "Ineligible"}
      </div>
      {diff ? (
        <div className="mt-1 flex flex-col gap-0.5 border-t pt-1">
          {diff.length === 0 ? (
            <span className="text-muted-foreground">Same values as the baseline</span>
          ) : (
            diff.slice(0, maxDiffRows).map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground truncate">{row.label}</span>
                <span className="tabular-nums">
                  {row.from} → {row.to}
                </span>
              </div>
            ))
          )}
          {diff.length > maxDiffRows ? (
            <span className="text-muted-foreground">+{diff.length - maxDiffRows} more changed</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
