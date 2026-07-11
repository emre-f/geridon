import type { OptimizationTrialRecord } from "@/lib/api-optimization-experiment-types";

export type TrialFilter = "all" | "eligible" | "ineligible" | "promoted";

export function matchesTrialFilter(trial: OptimizationTrialRecord, filter: TrialFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "eligible":
      return trial.eligible === true;
    case "ineligible":
      return trial.eligible === false;
    case "promoted":
      return trial.status === "scored";
  }
}

export function inChartOrder(trials: OptimizationTrialRecord[]): OptimizationTrialRecord[] {
  return [...trials].sort((a, b) => a.trial_index - b.trial_index);
}

// Mirrors the API's leaderboard ordering: ranked trials first by rank, then
// unranked ones by trial index.
export function inLeaderboardOrder(trials: OptimizationTrialRecord[]): OptimizationTrialRecord[] {
  return [...trials].sort((a, b) => {
    if ((a.rank == null) !== (b.rank == null)) {
      return a.rank == null ? 1 : -1;
    }
    if (a.rank != null && b.rank != null && a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.trial_index - b.trial_index;
  });
}

export interface TracePoint {
  trialIndex: number;
  score: number;
  eligible: boolean;
  status: OptimizationTrialRecord["status"];
  bestSoFar: number | null;
}

// Pruned trials carry a cheap-stage score worth plotting, but only fully
// scored trials advance the best-so-far line.
export function traceSeries(trials: OptimizationTrialRecord[]): TracePoint[] {
  const points: TracePoint[] = [];
  let best: number | null = null;
  for (const trial of inChartOrder(trials)) {
    if (trial.score == null) {
      continue;
    }
    if (trial.status === "scored" && (best == null || trial.score.score > best)) {
      best = trial.score.score;
    }
    points.push({
      trialIndex: trial.trial_index,
      score: trial.score.score,
      eligible: trial.score.eligible,
      status: trial.status,
      bestSoFar: best,
    });
  }
  return points;
}
