import type {
  OptimizationExperimentConfig,
  OptimizationExperimentListItem,
  OptimizationExperimentRecord,
  OptimizationExperimentSnapshot,
  OptimizationExperimentStatus,
  OptimizationTrialRecord,
} from "../../types.ts";

export type Row = Record<string, unknown>;

export function experimentRecord(row: Row): OptimizationExperimentRecord {
  return {
    id: Number(row.id),
    status: String(row.status) as OptimizationExperimentStatus,
    config: JSON.parse(String(row.config)),
    snapshot: JSON.parse(String(row.snapshot)),
    progress: row.progress == null ? null : JSON.parse(String(row.progress)),
    summary: row.summary == null ? null : JSON.parse(String(row.summary)),
    error: row.error == null ? null : String(row.error),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function experimentListItem(row: Row): OptimizationExperimentListItem {
  const config = JSON.parse(String(row.config)) as OptimizationExperimentConfig;
  const snapshot = JSON.parse(String(row.snapshot)) as OptimizationExperimentSnapshot;
  return {
    id: Number(row.id),
    status: String(row.status) as OptimizationExperimentStatus,
    strategy_id: config.strategy_id,
    strategy_name: snapshot.strategy_name,
    tickers: config.tickers,
    timeframe: config.timeframe,
    method: config.method,
    max_trials: config.max_trials,
    progress: row.progress == null ? null : JSON.parse(String(row.progress)),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function trialRecord(row: Row): OptimizationTrialRecord {
  return {
    experiment_id: Number(row.experiment_id),
    trial_index: Number(row.trial_index),
    hash: String(row.hash),
    phase: String(row.phase) as "search" | "refine",
    status: String(row.status) as OptimizationTrialRecord["status"],
    rejection_reason: row.rejection_reason == null ? null : String(row.rejection_reason),
    stage_reached: Number(row.stage_reached),
    rank: row.leaderboard_rank == null ? null : Number(row.leaderboard_rank),
    eligible: row.eligible == null ? null : Number(row.eligible) === 1,
    score: row.score_detail == null ? null : JSON.parse(String(row.score_detail)),
    values: JSON.parse(String(row.trial_values)),
    complexity: JSON.parse(String(row.complexity)),
  };
}
