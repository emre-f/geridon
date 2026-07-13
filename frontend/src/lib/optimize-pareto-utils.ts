import type {
  OptimizationExperimentSummary,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";

export interface ParetoChartPoint {
  trialIndex: number;
  rank: number | null;
  objective: number;
  drawdownPct: number;
  onFront: boolean;
  eligible: boolean;
}

export interface ParetoChartData {
  points: ParetoChartPoint[];
  /** Front points ordered by drawdown so they can be drawn as one frontier line. */
  front: ParetoChartPoint[];
  baseline: { objective: number; drawdownPct: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The return-versus-drawdown trade-off over every scored trial, with the first
 * non-dominated front from `summary.pareto_fronts` marked as the frontier.
 */
export function paretoChartData(
  summary: OptimizationExperimentSummary,
  trials: OptimizationTrialRecord[],
): ParetoChartData | null {
  const frontIndexes = new Set(summary.pareto_fronts[0] ?? []);
  const points: ParetoChartPoint[] = [];
  for (const trial of trials) {
    if (trial.status !== "scored" || trial.score == null || trial.metrics == null) {
      continue;
    }
    points.push({
      trialIndex: trial.trial_index,
      rank: trial.rank,
      objective: trial.score.medianObjective,
      drawdownPct: trial.metrics.median_drawdown_pct,
      onFront: frontIndexes.has(trial.trial_index),
      eligible: trial.score.eligible,
    });
  }
  if (points.length < 2 || summary.baseline.foldResults.length === 0) {
    return null;
  }

  return {
    points,
    front: points
      .filter((point) => point.onFront)
      .sort((a, b) => a.drawdownPct - b.drawdownPct || a.objective - b.objective),
    baseline: {
      objective: summary.baseline.score.medianObjective,
      drawdownPct: median(
        summary.baseline.foldResults.map((fold) => Math.abs(fold.max_drawdown_pct)),
      ),
    },
  };
}
