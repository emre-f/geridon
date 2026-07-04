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

export type IndicatorKind = "sma" | "ema" | "rsi" | "macd" | "bollinger" | "atr";

export type IndicatorPlacement = "overlay" | "pane";

export type IndicatorValueStyle = "line" | "histogram";

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
