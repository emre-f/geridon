export interface PreflightEvaluationEstimate {
  total: number;
  search: number;
  refinement: number;
  baseline_and_benchmarks: number;
  ablation_max: number;
}

export interface PreflightBenchmark {
  fold_backtests: number;
  elapsed_ms: number;
  ms_per_evaluation: number;
}

export interface PreflightFoldWindow {
  index: number;
  train_start_ms: number;
  train_end_ms: number;
  valid_start_ms: number;
  valid_end_ms: number;
}

export interface PreflightHoldoutWindow {
  start_ms: number;
  end_ms: number;
  candle_count: number;
}

export interface PreflightSymbolTimeline {
  ticker: string;
  candle_count: number;
  search_start_ms: number;
  search_end_ms: number;
  search_candle_count: number;
  folds: PreflightFoldWindow[];
  holdout: PreflightHoldoutWindow | null;
}

/** Cost estimate and data-role timeline for a draft experiment; persists nothing. */
export interface ExperimentPreflight {
  evaluations: PreflightEvaluationEstimate;
  benchmark: PreflightBenchmark;
  estimated_runtime_ms: number;
  max_runtime_ms: number;
  runtime_capped: boolean;
  timeline: PreflightSymbolTimeline[];
}
