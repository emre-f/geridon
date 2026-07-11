import type { BacktestPositionMode, Candle, Strategy, StrategyRule, TradeCosts } from "../types.ts";

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

export type SearchSpaceNode = NumericSearchNode | CategoricalSearchNode | ToggleSearchNode;

export type SampledValue = number | boolean;
export type TrialValues = Record<string, SampledValue>;

export type RuleRole = "required" | "optional" | "off";

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
  folds: FoldsConfig;
  scoring?: Partial<ScoringConfig>;
  ruleRoles?: Record<string, RuleRole>;
  parameterOverrides?: Record<string, ParameterOverride>;
  halving?: Partial<SuccessiveHalvingConfig>;
  refinement?: Partial<RefinementConfig>;
  method?: "random" | "tpe" | "evolution";
  tpe?: Partial<TpeConfig>;
  evolution?: Partial<EvolutionSearchConfig>;
}

export interface OptimizationControl {
  shouldStop?: () => boolean;
  onEvaluation?: (evaluatedCount: number) => void;
}

export interface AblationEntry {
  ruleId: string;
  summary: string;
  skipped: boolean;
  skipReason?: string;
  score: TrialScore | null;
  scoreDelta: number | null;
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
  /** Trial indexes grouped into non-dominated fronts (front 0 is the Pareto set). */
  paretoFronts: number[][];
  stoppedEarly: boolean;
}
