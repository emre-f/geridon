import type { OptimizationExperimentRecord, OptimizationTrialRecord } from "@/lib/api";
import {
  bestScoredTrial,
  formatDuration,
  objectiveLabels,
} from "@/lib/optimize-chart-utils";
import { cn } from "@/lib/utils";

interface Tile {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}

function formatScore(value: number) {
  return value.toFixed(2);
}

function buildTiles(
  experiment: OptimizationExperimentRecord,
  trials: OptimizationTrialRecord[],
): Tile[] {
  const summary = experiment.summary;
  if (!summary) {
    return [];
  }
  const objective = objectiveLabels[experiment.config.scoring?.objective ?? "sharpe"];
  const baselineScore = summary.baseline.score.score;
  const best = bestScoredTrial(trials, summary.best_trial_index);
  const bestScore = best?.score?.score ?? null;
  const delta = bestScore != null ? bestScore - baselineScore : null;
  const counts = summary.trial_counts;

  return [
    {
      label: "Baseline score",
      value: formatScore(baselineScore),
      detail: summary.baseline.score.eligible ? undefined : "ineligible",
    },
    {
      label: "Best score",
      value: bestScore != null ? formatScore(bestScore) : "—",
      detail: best ? `trial ${best.trial_index}` : "no scored trials",
    },
    {
      label: "vs baseline",
      value: delta != null ? `${delta >= 0 ? "+" : ""}${formatScore(delta)}` : "—",
      tone:
        delta == null
          ? undefined
          : delta >= 0
            ? "text-[var(--chart-up)]"
            : "text-[var(--chart-down)]",
    },
    {
      label: "Buy & hold",
      value: formatScore(summary.buy_hold.medianObjective),
      detail: `median ${objective}`,
    },
    {
      label: "Trials scored",
      value: String(counts.scored),
      detail: `${counts.pruned} pruned · ${counts.rejected} rejected`,
    },
    {
      label: "Elapsed",
      value: formatDuration(summary.elapsed_ms),
      detail: summary.stopped_early ? "stopped early" : undefined,
    },
  ];
}

export function OptimizeStatTiles({
  experiment,
  trials,
}: {
  experiment: OptimizationExperimentRecord;
  trials: OptimizationTrialRecord[];
}) {
  const tiles = buildTiles(experiment, trials);
  if (tiles.length === 0) {
    return null;
  }

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-muted/30 flex flex-col gap-0.5 rounded-md p-2.5">
          <dt className="text-muted-foreground text-xs">{tile.label}</dt>
          <dd className="flex flex-col">
            <span className={cn("text-lg font-semibold", tile.tone)}>{tile.value}</span>
            {tile.detail ? (
              <span className="text-muted-foreground/70 text-[11px]">{tile.detail}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
