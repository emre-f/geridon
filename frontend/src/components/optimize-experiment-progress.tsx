import type { OptimizationExperimentListItem } from "@/lib/api";
import { progressFraction } from "@/lib/optimize-utils";
import { cn } from "@/lib/utils";

export function OptimizeExperimentProgress({
  experiment,
}: {
  experiment: OptimizationExperimentListItem;
}) {
  const fraction = progressFraction(experiment);
  const maxTrials = experiment.max_trials;
  const evaluated = Math.min(experiment.progress?.evaluated_trials ?? 0, maxTrials);

  if (fraction == null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
      <div className="bg-accent h-1.5 w-16 shrink-0 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            experiment.status === "running" ? "bg-primary" : "bg-muted-foreground/50",
          )}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <span className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
        {evaluated}/{maxTrials} trials
      </span>
    </div>
  );
}
