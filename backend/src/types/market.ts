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
