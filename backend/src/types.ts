export interface Timeframe {
  multiplier: number;
  timespan: "hour" | "day";
  key: string;
}

export interface Candle {
  id?: number;
  ticker: string;
  multiplier: number;
  timespan: string;
  timestamp_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  transactions: number | null;
  source?: string;
  created_at?: string;
}

export interface FetchRange {
  id?: number;
  ticker: string;
  multiplier: number;
  timespan: string;
  start_ms: number;
  end_ms: number;
  source: string;
  status: string;
  created_at?: string;
}

export interface CandleResponse {
  ticker: string;
  timeframe: string;
  timestamp_ms: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  transactions: number | null;
}

export interface SymbolTimeframeResponse {
  timeframe: string;
  candles: number;
  start_ms: number;
  start: string;
  end_ms: number;
  end: string;
}

export interface SymbolResponse {
  ticker: string;
  timeframes: SymbolTimeframeResponse[];
}

export interface SymbolValidationResponse {
  ticker: string;
  valid: boolean;
}

export interface DeleteSymbolResponse {
  ticker: string;
  candles_deleted: number;
  fetch_ranges_deleted: number;
}

export interface SyncCandlesRequest {
  ticker: string;
  start: string;
  end: string;
  timeframe?: string;
  adjusted?: boolean;
  source?: "polygon" | "yahoo";
}

export interface SyncCandlesResponse {
  ticker: string;
  source: string;
  timeframe: string;
  requested_start: string;
  requested_end: string;
  fetched_ranges: number;
  candles_received: number;
  candles_inserted: number;
  candles_skipped: number;
}

// Open-ended so new indicators only need a catalog entry; validity is checked
// against the runtime catalog, not the type system.
export type IndicatorKind = string;

export type IndicatorPlacement = "overlay" | "pane" | "volume";

export type IndicatorValueStyle = "line" | "histogram" | "none";

export interface IndicatorParameterDefinition {
  key: string;
  label: string;
  default_value: number;
  min: number;
  max: number;
  step: number;
}

export interface IndicatorDefinition {
  kind: IndicatorKind;
  label: string;
  full_name: string;
  description: string;
  placement: IndicatorPlacement;
  parameters: IndicatorParameterDefinition[];
  values: IndicatorValueDefinition[];
}

export interface IndicatorSpec {
  id?: string;
  kind: IndicatorKind;
  parameters?: Record<string, number>;
}

export interface IndicatorValueDefinition {
  key: string;
  label: string;
  style: IndicatorValueStyle;
}

export interface IndicatorPointResponse {
  timestamp_ms: number;
  timestamp: string;
  values: Record<string, number | null>;
}

export interface IndicatorSeriesResponse {
  id: string;
  kind: IndicatorKind;
  label: string;
  placement: IndicatorPlacement;
  parameters: Record<string, number>;
  values: IndicatorValueDefinition[];
  points: IndicatorPointResponse[];
}

export type PriceField = "open" | "high" | "low" | "close" | "volume";

export type ComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "cross_above"
  | "cross_below";

export type GroupOperator = "and" | "or" | "not";

export interface IndicatorOperand {
  type: "indicator";
  kind: IndicatorKind;
  parameters: Record<string, number>;
  output: string;
}

export interface PriceOperand {
  type: "price";
  field: PriceField;
}

export interface ValueOperand {
  type: "value";
  value: number;
}

export type StrategyOperand = IndicatorOperand | PriceOperand | ValueOperand;

export interface StrategyRule {
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
}

export interface StrategyGroup {
  type: "group";
  operator: GroupOperator;
  conditions: StrategyCondition[];
}

export type StrategyCondition = StrategyRule | StrategyGroup;

export interface Strategy {
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
}

export interface StrategyRecord {
  id: number;
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
  created_at: string;
  updated_at: string;
}

export interface StrategyValidationIssue {
  path: string;
  message: string;
}

export interface StrategyValidationResponse {
  valid: boolean;
  errors: StrategyValidationIssue[];
  strategy: Strategy | null;
}

export interface StrategySignal {
  timestamp_ms: number;
  side: "buy" | "sell";
}

export interface PolygonAggregate {
  timestamp_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  transactions: number | null;
}

export type MarketDataCandle = PolygonAggregate;
