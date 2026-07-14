export interface TradeCosts {
  commission_per_trade: number;
  commission_pct: number;
  slippage_bps: number;
}

export type OptimizationExperimentStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

export type OptimizationMethod = "random" | "tpe" | "evolution";

export type RuleRole = "required" | "optional" | "off";

export interface ParameterOverride {
  locked?: boolean;
  min?: number;
  max?: number;
  step?: number;
  choices?: number[];
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
  choices: string[];
  current: string;
}

export type SearchSpaceNode =
  | NumericSearchNode
  | CategoricalSearchNode
  | ToggleSearchNode
  | OperatorSearchNode;

export type SampledValue = number | boolean | string;
export type TrialValues = Record<string, SampledValue>;

/** Opt-in structural dimensions: which rule operators and group counts to search. */
export interface StructureSearchConfig {
  operators?: string[];
  at_least?: string[];
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

export interface BaselineEvaluation {
  foldResults: FoldEvaluation[];
  score: TrialScore;
  complexity: StrategyComplexity;
}

export interface BuyHoldEvaluation {
  foldResults: FoldEvaluation[];
  medianObjective: number;
}
