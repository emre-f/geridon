import type { OptimizationExperimentListItem } from "@/lib/api";
import { progressFraction } from "@/lib/optimize-utils";
import { cn } from "@/lib/utils";

export function OptimizeExperimentProgress({
  experiment,
}: {
  experiment: OptimizationExperimentListItem;
}) {
  const fraction = progressFraction(experiment);
  const evaluated = experiment.progress?.evaluated_trials ?? 0;

  if (fraction == null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="bg-accent h-1.5 w-16 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            experiment.status === "running" ? "bg-primary" : "bg-muted-foreground/50",
          )}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {evaluated}/{experiment.max_trials}
      </span>
    </div>
  );
}
