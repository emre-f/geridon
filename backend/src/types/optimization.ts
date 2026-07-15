import type {
  BacktestPositionMode,
  Candle,
  ComparisonOperator,
  Strategy,
  StrategyRule,
  TradeCosts,
} from "../types.ts";

export interface NumericSearchNode {
  id: string;
  kind: "numeric";
  path: string[];
  valueType: "integer" | "decimal";
  min: number;
  max: number;
  step: number;
  scale: "linear" | "log";
  current: number;
}

export interface CategoricalSearchNode {
  id: string;
  kind: "categorical";
  path: string[];
  choices: number[];
  current: number;
}

export interface ToggleSearchNode {
  id: string;
  kind: "toggle";
  path: string[];
  current: boolean;
}

export interface OperatorSearchNode {
  id: string;
  kind: "operator";
  path: string[];
  choices: ComparisonOperator[];
  current: ComparisonOperator;
}

export type SearchSpaceNode =
  | NumericSearchNode
  | CategoricalSearchNode
  | ToggleSearchNode
  | OperatorSearchNode;

export type SampledValue = number | boolean | string;
export type TrialValues = Record<string, SampledValue>;

export type RuleRole = "required" | "optional" | "off";

/** Buy/sell percent sampled for one candidate; only searchable in long_only. */
export interface TrialSizing {
  buyPercent?: number;
  sellPercent?: number;
}

/** Opt-in structural dimensions: which rule operators and group counts to search. */
export interface StructureSearchConfig {
  operators?: string[];
  atLeast?: string[];
}

export interface ParameterOverride {
  locked?: boolean;
  min?: number;
  max?: number;
  step?: number;
  choices?: number[];
}

export interface OptimizationDataset {
  symbol: string;
  candles: Candle[];
}

export interface FoldSpec {
  index: number;
  trainStartIndex: number;
  trainEndIndex: number;
  validStartIndex: number;
  validEndIndex: number;
}

export interface FoldsConfig {
  foldCount: number;
  mode: "anchored" | "rolling";
  minValidationCandles?: number;
  /**
   * Purge gap between each training window and its validation window, sized by
   * the user from the label/trade horizon. Gap candles warm indicators but are
   * neither training evidence nor scored.
   */
  embargoCandles?: number;
}

export type OptimizationObjective = "sharpe" | "annualized_return" | "total_return";

export interface ScorePenaltyWeights {
  drawdown: number;
  instability: number;
  turnover: number;
  complexity: number;
}

export interface EligibilityConstraints {
  minTotalTrades: number;
  maxDrawdownPct: number;
  minPositiveFoldFraction: number;
}

export interface ScoringConfig {
  objective: OptimizationObjective;
  penalties: ScorePenaltyWeights;
  constraints: EligibilityConstraints;
}

export interface FoldEvaluation {
  symbol: string;
  foldIndex: number;
  objectiveValue: number | null;
  total_return_pct: number;
  annualized_return_pct: number | null;
  sharpe_ratio: number | null;
  max_drawdown_pct: number;
  trade_count: number;
  candle_count: number;
  /** Absent on trials evaluated before these metrics existed. */
  exposure_pct?: number;
  turnover_ratio?: number | null;
}

export interface StrategyComplexity {
  activeRules: number;
  uniqueIndicators: number;
  maxDepth: number;
}

export interface TrialScore {
  score: number;
  medianObjective: number;
  eligible: boolean;
  ineligibilityReasons: string[];
  penalties: { drawdown: number; instability: number; turnover: number; complexity: number };
}

export type TrialStatus = "pending" | "scored" | "pruned" | "rejected";

export interface OptimizationTrial {
  index: number;
  hash: string;
  values: TrialValues;
  strategy: Strategy;
  status: TrialStatus;
  rejectionReason?: string;
  /** Present when sizing was searched and this candidate's values deviate from config. */
  sizing?: TrialSizing;
  stageReached: number;
  foldResults: FoldEvaluation[];
  score: TrialScore | null;
  complexity: StrategyComplexity;
  phase: "search" | "refine";
}

export interface SuccessiveHalvingConfig {
  stageFoldFractions: number[];
  promotionRate: number;
}

export interface RefinementConfig {
  enabled: boolean;
  topCount: number;
  trials: number;
}

export interface TpeConfig {
  gamma: number;
  startupTrials: number;
  candidateCount: number;
}

export interface EvolutionSearchConfig {
  populationSize: number;
  eliteCount: number;
  ruleLibrary: StrategyRule[];
  insertionPoints: string[];
  maxNewRulesPerSide: number;
  maxActiveRulesPerSide: number;
  maxUniqueIndicatorsPerSide: number;
  maxTreeDepth: number;
}

export interface IndicatorCacheConfig {
  enabled?: boolean;
  /** Memory bound as a total count of cached series values. */
  maxValues?: number;
}

/** Fold evaluations persisted by an interrupted run, reusable on resume. */
export interface CheckpointTrialFolds {
  hash: string;
  foldResults: FoldEvaluation[];
}

export interface OptimizationConfig {
  strategy: Strategy;
  datasets: OptimizationDataset[];
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  costs?: TradeCosts;
  seed: number;
  maxTrials: number;
  maxRuntimeMs?: number;
  /** Parallel fold-evaluation workers; 1 (default) keeps the single-threaded path. */
  workerCount?: number;
  folds: FoldsConfig;
  scoring?: Partial<ScoringConfig>;
  ruleRoles?: Record<string, RuleRole>;
  parameterOverrides?: Record<string, ParameterOverride>;
  structure?: StructureSearchConfig;
  halving?: Partial<SuccessiveHalvingConfig>;
  refinement?: Partial<RefinementConfig>;
  method?: "random" | "tpe" | "evolution";
  tpe?: Partial<TpeConfig>;
  evolution?: Partial<EvolutionSearchConfig>;
  cache?: IndicatorCacheConfig;
  checkpoint?: CheckpointTrialFolds[];
}

export interface OptimizationControl {
  shouldStop?: () => boolean;
  onTrialComplete?: (completedCount: number) => void;
  /** Fires once per finished trial with its final status, score, and folds. */
  onTrialFinished?: (trial: OptimizationTrial) => void;
  /** Fires once, before search starts, with the baseline's robust score. */
  onBaseline?: (score: number) => void;
}

export interface AblationEntry {
  ruleId: string;
  summary: string;
  skipped: boolean;
  skipReason?: string;
  score: TrialScore | null;
  scoreDelta: number | null;
}

export interface RuleInclusionEntry {
  ruleId: string;
  summary: string;
  includedCount: number;
  topCount: number;
}

export interface BaselineEvaluation {
  foldResults: FoldEvaluation[];
  score: TrialScore;
  complexity: StrategyComplexity;
}

export interface BuyHoldEvaluation {
  foldResults: FoldEvaluation[];
  medianObjective: number;
}

/**
 * How the best candidate's neighborhood in one search dimension scored:
 * a robust region keeps scoring well nearby, a lucky spike does not.
 */
export interface ParameterStabilityEntry {
  nodeId: string;
  bestValue: number;
  bestScore: number;
  neighborCount: number;
  neighborScoreMedian: number | null;
  neighborScoreMin: number | null;
}

export interface OptimizationResult {
  scoringVersion: string;
  seed: number;
  method: "random" | "tpe" | "evolution";
  space: SearchSpaceNode[];
  baseline: BaselineEvaluation;
  buyHold: BuyHoldEvaluation;
  trials: OptimizationTrial[];
  leaderboard: OptimizationTrial[];
  ablation: AblationEntry[];
  /** How often each rule is active among the top eligible candidates; empty unless rule structure was searched. */
  inclusion: RuleInclusionEntry[];
  /** Trial indexes grouped into non-dominated fronts (front 0 is the Pareto set). */
  paretoFronts: number[][];
  /** Neighborhood stability of the best candidate per numeric/curated dimension. */
  stability: ParameterStabilityEntry[];
  /** Fold evaluations reused from a resume checkpoint instead of recomputed. */
  checkpointFoldsReused: number;
  stoppedEarly: boolean;
}
