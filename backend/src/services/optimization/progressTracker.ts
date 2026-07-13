import type { OptimizationExperimentProgress, OptimizationTrial } from "../../types.ts";

/**
 * Accumulates live progress for one running experiment from the worker's
 * per-trial messages, so the progress JSON always reflects completed work.
 */
export class ProgressTracker {
  private scored = 0;
  private pruned = 0;
  private rejected = 0;
  private phase: "search" | "refine" = "search";
  private baselineScore: number | null = null;
  private readonly maxTrials: number;
  private readonly startedAtMs: number;

  constructor(maxTrials: number, startedAtMs: number) {
    this.maxTrials = maxTrials;
    this.startedAtMs = startedAtMs;
  }

  recordBaseline(score: number) {
    this.baselineScore = score;
  }

  recordTrial(trial: Pick<OptimizationTrial, "status" | "phase">) {
    if (trial.status === "scored") this.scored += 1;
    else if (trial.status === "pruned") this.pruned += 1;
    else if (trial.status === "rejected") this.rejected += 1;
    this.phase = trial.phase;
  }

  snapshot(nowMs: number): OptimizationExperimentProgress {
    return {
      evaluated_trials: this.scored + this.pruned + this.rejected,
      max_trials: this.maxTrials,
      updated_at_ms: nowMs,
      started_at_ms: this.startedAtMs,
      scored: this.scored,
      pruned: this.pruned,
      rejected: this.rejected,
      phase: this.phase,
      baseline_score: this.baselineScore,
    };
  }
}
