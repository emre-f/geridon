import type {
  BacktestPositionMode,
  BacktestRunRecord,
  BacktestRunSummary,
  Candle,
  DeleteSymbolResponse,
  IndicatorDefinition,
  IndicatorSeries,
  IndicatorSpec,
  SymbolSummary,
  SymbolValidation,
  SyncCandlesResponse,
} from "@/lib/api-types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String(body.detail)
        : response.statusText;
    throw new Error(detail);
  }

  return body as T;
}

export function listSymbols() {
  return fetchJson<SymbolSummary[]>("/api/v1/symbols");
}

export function listIndicatorCatalog() {
  return fetchJson<IndicatorDefinition[]>("/api/v1/indicators");
}

export function validateSymbol(ticker: string) {
  return fetchJson<SymbolValidation>(`/api/v1/symbols/${encodeURIComponent(ticker)}/validate`);
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

export function runBacktest(options: {
  strategyId: number;
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
}) {
  return fetchJson<BacktestRunRecord>("/api/v1/backtests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      strategy_id: options.strategyId,
      ticker: options.ticker,
      timeframe: options.timeframe,
      start_ms: options.startMs,
      end_ms: options.endMs,
      position_mode: options.positionMode,
      buy_percent: options.buyPercent,
      sell_percent: options.sellPercent,
      initial_capital: options.initialCapital,
    }),
  });
}

export function listStrategyBacktests(strategyId: number) {
  return fetchJson<BacktestRunSummary[]>(`/api/v1/strategies/${strategyId}/backtests`);
}

export function getBacktest(id: number) {
  return fetchJson<BacktestRunRecord>(`/api/v1/backtests/${id}`);
}

export function deleteBacktest(id: number) {
  return fetchJson<{ id: number; deleted: boolean }>(`/api/v1/backtests/${id}`, {
    method: "DELETE",
  });
}

export function fetchChartStates() {
  return fetchJson<Record<string, unknown>>("/api/v1/chart-states");
}

export function putChartState(ticker: string, state: unknown) {
  return fetchJson<{ ticker: string; saved: boolean }>(
    `/api/v1/chart-states/${encodeURIComponent(ticker)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    },
  );
}

export function listIndicators(options: {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  indicators: IndicatorSpec[];
}) {
  const params = new URLSearchParams({
    timeframe: options.timeframe,
    start: new Date(options.startMs).toISOString(),
    end: new Date(options.endMs).toISOString(),
    limit: "50000",
    indicators: JSON.stringify(options.indicators),
  });

  return fetchJson<IndicatorSeries[]>(
    `/api/v1/indicators/${encodeURIComponent(options.ticker)}?${params}`,
  );
}
