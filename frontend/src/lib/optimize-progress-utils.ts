import type { OptimizationExperimentListItem } from "@/lib/api-optimization-experiment-types";

export interface ExperimentProgressView {
  stageLabel: string;
  fraction: number;
  evaluated: number;
  maxTrials: number;
  trialsRemaining: number;
  /** Null while the worker is starting or on experiments run before counts existed. */
  counts: { scored: number; pruned: number; rejected: number } | null;
  elapsedMs: number | null;
  runtimeRemainingMs: number | null;
  baselineScore: number | null;
}

/** Everything the live progress card shows, derived from one polled list item. */
export function experimentProgressView(
  experiment: OptimizationExperimentListItem,
  nowMs: number,
): ExperimentProgressView {
  const progress = experiment.progress;
  const evaluated = Math.min(progress?.evaluated_trials ?? 0, experiment.max_trials);

  const stageLabel =
    experiment.status === "queued"
      ? "Queued"
      : progress == null
        ? "Starting"
        : progress.phase === "refine"
          ? "Refining around the best candidates"
          : "Searching";

  const elapsedMs =
    experiment.status === "running" && progress?.started_at_ms != null
      ? Math.max(0, nowMs - progress.started_at_ms)
      : null;

  return {
    stageLabel,
    fraction: experiment.max_trials > 0 ? Math.min(1, evaluated / experiment.max_trials) : 0,
    evaluated,
    maxTrials: experiment.max_trials,
    trialsRemaining: Math.max(0, experiment.max_trials - evaluated),
    counts:
      progress?.scored != null
        ? {
            scored: progress.scored,
            pruned: progress.pruned ?? 0,
            rejected: progress.rejected ?? 0,
          }
        : null,
    elapsedMs,
    runtimeRemainingMs:
      elapsedMs == null ? null : Math.max(0, experiment.max_runtime_ms - elapsedMs),
    baselineScore: progress?.baseline_score ?? null,
  };
}
