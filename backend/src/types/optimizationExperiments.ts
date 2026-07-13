import type {
  AblationEntry,
  BacktestPositionMode,
  BaselineEvaluation,
  BuyHoldEvaluation,
  EvolutionSearchConfig,
  FoldEvaluation,
  FoldsConfig,
  ParameterOverride,
  RefinementConfig,
  RuleInclusionEntry,
  RuleRole,
  ScoringConfig,
  SearchSpaceNode,
  Strategy,
  StrategyComplexity,
  SuccessiveHalvingConfig,
  TpeConfig,
  TradeCosts,
  TrialScore,
  TrialStatus,
  TrialValues,
} from "../types.ts";

export type OptimizationExperimentStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

export type OptimizationMethod = "random" | "tpe" | "evolution";

/** Seals the last `fraction` of each symbol's candles from search and validation. */
export interface HoldoutConfig {
  fraction: number;
}

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
  holdout?: HoldoutConfig;
  scoring?: Partial<ScoringConfig>;
  rule_roles?: Record<string, RuleRole>;
  parameter_overrides?: Record<string, ParameterOverride>;
  halving?: Partial<SuccessiveHalvingConfig>;
  refinement?: Partial<RefinementConfig>;
  tpe?: Partial<TpeConfig>;
  evolution?: Partial<EvolutionSearchConfig>;
}

export interface SearchSpacePreviewRule {
  id: string;
  side: "entry" | "exit" | "cash";
  summary: string;
  enabled: boolean;
}

export type SearchSpacePreviewNode = SearchSpaceNode & {
  /** Catalog bounds for indicator parameters; null for free value thresholds. */
  hard_min: number | null;
  hard_max: number | null;
};

/** Default-compiled search space for one strategy, served to the experiment form. */
export interface SearchSpacePreview {
  strategy_id: number;
  rules: SearchSpacePreviewRule[];
  nodes: SearchSpacePreviewNode[];
}

export interface ExperimentDatasetSpec {
  ticker: string;
  candle_count: number;
  first_candle_ms: number;
  last_candle_ms: number;
  /** Trailing candles sealed from search; absent on experiments without a holdout. */
  holdout_candle_count?: number;
  /** Distinct sync sources of the stored candles; absent on older experiments. */
  sources?: string[];
}

export interface OptimizationExperimentSnapshot {
  strategy: Strategy;
  strategy_name: string;
  datasets: ExperimentDatasetSpec[];
  /** Absent on experiments created before versioning existed. */
  catalog_version?: number;
  search_space_version?: number;
  /** Recorded dividend/split assumption; absent on older experiments. */
  price_adjustment?: string;
}

export interface OptimizationExperimentProgress {
  evaluated_trials: number;
  max_trials: number;
  updated_at_ms: number;
  /** Fields below are absent on experiments run before the live progress view existed. */
  started_at_ms?: number;
  scored?: number;
  pruned?: number;
  rejected?: number;
  phase?: "search" | "refine";
  baseline_score?: number | null;
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
  /** Absent on experiments that finished before inclusion reporting existed. */
  inclusion?: RuleInclusionEntry[];
  pareto_fronts: number[][];
  trial_counts: OptimizationTrialCounts;
  best_trial_index: number | null;
}

/** The one-time evaluation of a chosen candidate on the sealed holdout window. */
export interface HoldoutEvaluation {
  trial_index: number;
  opened_at: string;
  candidate: FoldEvaluation[];
  baseline: FoldEvaluation[];
  buy_hold: FoldEvaluation[];
}

export interface OptimizationExperimentRecord {
  id: number;
  status: OptimizationExperimentStatus;
  config: OptimizationExperimentConfig;
  snapshot: OptimizationExperimentSnapshot;
  progress: OptimizationExperimentProgress | null;
  summary: OptimizationExperimentSummary | null;
  holdout: HoldoutEvaluation | null;
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
  max_runtime_ms: number;
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
  strategy: Strategy | null;
  fold_results: FoldEvaluation[];
}

export interface EquityPoint {
  timestamp_ms: number;
  equity: number;
}

export interface FoldEquityCurve {
  symbol: string;
  foldIndex: number;
  points: EquityPoint[];
}

export interface TrialEquityResponse {
  trial_index: number;
  initial_capital: number;
  candidate: FoldEquityCurve[];
  baseline: FoldEquityCurve[];
}
