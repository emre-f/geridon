import type { BacktestPositionMode } from "@/lib/api-backtest-types";
import type {
  AblationEntry,
  BaselineEvaluation,
  BuyHoldEvaluation,
  FoldEvaluation,
  FoldsConfig,
  OptimizationExperimentStatus,
  OptimizationMethod,
  ParameterOverride,
  RuleRole,
  ScoringConfig,
  SearchSpaceNode,
  StrategyComplexity,
  TradeCosts,
  TrialScore,
  TrialStatus,
  TrialValues,
} from "@/lib/api-optimization-types";
import type { StrategySnapshot } from "@/lib/api-strategy-types";

export interface OptimizationExperimentConfig {
  strategy_id: number;
  tickers: string[];
  timeframe: string;
  start_ms: number;
  end_ms: number;
  position_mode: BacktestPositionMode;
  buy_percent: number;
  sell_percent: number;
  initial_capital: number;
  costs: TradeCosts;
  seed: number;
  max_trials: number;
  max_runtime_ms: number;
  method: OptimizationMethod;
  folds: FoldsConfig;
  scoring?: Partial<ScoringConfig>;
  rule_roles?: Record<string, RuleRole>;
  parameter_overrides?: Record<string, ParameterOverride>;
}

export interface ExperimentDatasetSpec {
  ticker: string;
  candle_count: number;
  first_candle_ms: number;
  last_candle_ms: number;
}

export interface OptimizationExperimentSnapshot {
  strategy: StrategySnapshot;
  strategy_name: string;
  datasets: ExperimentDatasetSpec[];
}

export interface OptimizationExperimentProgress {
  evaluated_trials: number;
  max_trials: number;
  updated_at_ms: number;
}

export interface OptimizationTrialCounts {
  total: number;
  scored: number;
  pruned: number;
  rejected: number;
}

export interface OptimizationExperimentSummary {
  scoring_version: string;
  stopped_early: boolean;
  elapsed_ms: number;
  baseline: BaselineEvaluation;
  buy_hold: BuyHoldEvaluation;
  space: SearchSpaceNode[];
  ablation: AblationEntry[];
  pareto_fronts: number[][];
  trial_counts: OptimizationTrialCounts;
  best_trial_index: number | null;
}

export interface OptimizationExperimentRecord {
  id: number;
  status: OptimizationExperimentStatus;
  config: OptimizationExperimentConfig;
  snapshot: OptimizationExperimentSnapshot;
  progress: OptimizationExperimentProgress | null;
  summary: OptimizationExperimentSummary | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OptimizationExperimentListItem {
  id: number;
  status: OptimizationExperimentStatus;
  strategy_id: number;
  strategy_name: string;
  tickers: string[];
  timeframe: string;
  method: OptimizationMethod;
  max_trials: number;
  progress: OptimizationExperimentProgress | null;
  created_at: string;
  updated_at: string;
}

export interface OptimizationTrialMetrics {
  median_return_pct: number;
  worst_fold_return_pct: number;
  median_drawdown_pct: number;
  worst_drawdown_pct: number;
  total_trades: number;
  median_turnover_ratio: number | null;
  fold_count: number;
}

export interface OptimizationTrialRecord {
  experiment_id: number;
  trial_index: number;
  hash: string;
  phase: "search" | "refine";
  status: TrialStatus;
  rejection_reason: string | null;
  stage_reached: number;
  rank: number | null;
  eligible: boolean | null;
  score: TrialScore | null;
  values: TrialValues;
  complexity: StrategyComplexity;
  metrics: OptimizationTrialMetrics | null;
}

export interface OptimizationTrialDetail extends OptimizationTrialRecord {
  strategy: StrategySnapshot | null;
  fold_results: FoldEvaluation[];
}
