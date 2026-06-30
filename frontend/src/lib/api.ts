export interface SymbolTimeframe {
  timeframe: string;
  candles: number;
  start_ms: number;
  start: string;
  end_ms: number;
  end: string;
}

export interface SymbolSummary {
  ticker: string;
  timeframes: SymbolTimeframe[];
}

export interface SymbolValidation {
  ticker: string;
  valid: boolean;
}

export interface DeleteSymbolResponse {
  ticker: string;
  candles_deleted: number;
  fetch_ranges_deleted: number;
}

export interface Candle {
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body ? String(body.detail) : response.statusText;
    throw new Error(detail);
  }

  return body as T;
}

export function listSymbols() {
  return fetchJson<SymbolSummary[]>("/api/v1/symbols");
}

export function validateSymbol(ticker: string) {
  return fetchJson<SymbolValidation>(
    `/api/v1/symbols/${encodeURIComponent(ticker)}/validate`,
  );
}

export function deleteSymbol(ticker: string) {
  return fetchJson<DeleteSymbolResponse>(`/api/v1/symbols/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
}

export function syncCandles(options: {
  ticker: string;
  timeframe: string;
  start: string;
  end: string;
  source?: "polygon" | "yahoo";
  adjusted?: boolean;
}) {
  return fetchJson<SyncCandlesResponse>("/api/v1/candles/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source: options.source ?? "yahoo",
      ticker: options.ticker,
      start: options.start,
      end: options.end,
      timeframe: options.timeframe,
      adjusted: options.adjusted ?? true,
    }),
  });
}

export function listCandles(options: {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
}) {
  const params = new URLSearchParams({
    timeframe: options.timeframe,
    start: new Date(options.startMs).toISOString(),
    end: new Date(options.endMs).toISOString(),
    limit: "50000",
  });

  return fetchJson<Candle[]>(`/api/v1/candles/${encodeURIComponent(options.ticker)}?${params}`);
}
