import { formatSampledValue } from "@/lib/optimize-chart-utils";
import type { StabilityRow, StabilityVerdict } from "@/lib/optimize-stability-utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const verdictLabels: Record<StabilityVerdict, string> = {
  robust: "Robust region",
  spiky: "Lucky spike?",
  sparse: "Few nearby samples",
};

const verdictVariants: Record<StabilityVerdict, "default" | "destructive" | "outline"> = {
  robust: "default",
  spiky: "destructive",
  sparse: "outline",
};

function StabilityColumn({ rows }: { rows: StabilityRow[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {rows.map((row) => (
        <div key={row.nodeId} className="flex items-center gap-3">
          <span className="text-muted-foreground w-40 shrink-0 truncate text-xs" title={row.nodeId}>
            {row.label}
          </span>
          <span className="w-20 shrink-0 truncate text-xs tabular-nums">
            best {formatSampledValue(row.bestValue)}
          </span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs tabular-nums">
            {row.neighborScoreMedian != null
              ? `${row.neighborCount} nearby · median ${row.neighborScoreMedian.toFixed(3)}`
              : "no nearby trials"}
          </span>
          <Badge variant={verdictVariants[row.verdict]}>{verdictLabels[row.verdict]}</Badge>
        </div>
      ))}
    </div>
  );
}

/**
 * Neighborhood stability of the best candidate: for each searched dimension,
 * how trials sampled near the winning value scored.
 */
export function OptimizeStabilityList({
  rows,
  baselineScore,
}: {
  rows: StabilityRow[];
  baselineScore: number | null;
}) {
  if (rows.length === 0) {
    return null;
  }
  const midpoint = Math.ceil(rows.length / 2);
  const secondColumn = rows.slice(midpoint);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1 lg:flex-row lg:gap-6">
        <StabilityColumn rows={rows.slice(0, midpoint)} />
        {secondColumn.length > 0 ? (
          <>
            <Separator orientation="vertical" className="hidden h-auto lg:block" />
            <StabilityColumn rows={secondColumn} />
          </>
        ) : null}
      </div>
      <p className="text-muted-foreground px-1 text-xs">
        Trials sampled within 15% of each dimension&apos;s range around the best value
        {baselineScore != null
          ? `; a neighborhood median above the baseline score (${baselineScore.toFixed(3)}) reads as a robust region`
          : ""}
        . A winner whose neighbors collapse is weak evidence.
      </p>
    </div>
  );
}
