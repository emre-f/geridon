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

// Open-ended so new indicators only need a backend catalog entry; validity is
// checked against the fetched catalog, not the type system.
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

export interface IndicatorValueDefinition {
  key: string;
  label: string;
  description?: string;
  style: IndicatorValueStyle;
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

export type IndicatorLineStroke = "solid" | "dashed" | "dotted";

export interface IndicatorLineStyle {
  color: string;
  stroke: IndicatorLineStroke;
  width: number;
  opacity: number;
}

export interface IndicatorSpec {
  id: string;
  kind: IndicatorKind;
  parameters: Record<string, number>;
  styles?: IndicatorLineStyle[];
}

export interface IndicatorPoint {
  timestamp_ms: number;
  timestamp: string;
  values: Record<string, number | null>;
}

export interface IndicatorSeries {
  id: string;
  kind: IndicatorKind;
  label: string;
  placement: IndicatorPlacement;
  parameters: Record<string, number>;
  styles?: IndicatorLineStyle[];
  values: IndicatorValueDefinition[];
  points: IndicatorPoint[];
}

export type ComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "cross_above"
  | "cross_below";

export type GroupOperator = "and" | "or" | "not";

export type PriceField = "open" | "high" | "low" | "close" | "volume";

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
  /** Client-side key for editing; the backend ignores and never returns it. */
  id: string;
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
  /** Absent means enabled; false means the rule is skipped during evaluation. */
  enabled?: boolean;
}

export interface StrategyGroup {
  id: string;
  type: "group";
  operator: GroupOperator;
  conditions: StrategyCondition[];
  /** Absent means enabled; false means the whole group is skipped during evaluation. */
  enabled?: boolean;
}

export type StrategyCondition = StrategyRule | StrategyGroup;

export interface StrategyDraft {
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
}

export interface StrategyRecord extends StrategyDraft {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface StrategyValidationIssue {
  path: string;
  message: string;
}

export interface StrategyValidationResult {
  valid: boolean;
  errors: StrategyValidationIssue[];
}

export interface StrategySignal {
  timestamp_ms: number;
  side: "buy" | "sell";
}

export type BacktestPositionMode = "long_only" | "always_in";

export interface BacktestTrade {
  timestamp_ms: number;
  side: "buy" | "sell";
  price: number;
  shares: number;
  value: number;
  cash_after: number;
  shares_after: number;
  equity_after: number;
  realized_pnl: number | null;
}

export interface BacktestEquityPoint {
  timestamp_ms: number;
  equity: number;
  cash: number;
  shares: number;
  position_value: number;
}

export interface BacktestMetrics {
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  trade_count: number;
  buy_count: number;
  sell_count: number;
  win_rate_pct: number | null;
  realized_pnl: number;
  candle_count: number;
  first_candle_ms: number | null;
  last_candle_ms: number | null;
}

export interface BacktestRunSummary {
  id: number;
  strategy_id: number;
  ticker: string;
  timeframe: string;
  start_ms: number;
  end_ms: number;
  position_mode: BacktestPositionMode;
  buy_percent: number;
  sell_percent: number;
  initial_capital: number;
  metrics: BacktestMetrics;
  created_at: string;
}

// Stored strategy snapshots come back without the client-side node ids that
// live StrategyCondition trees carry.
export interface SnapshotRule {
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
  enabled?: boolean;
}

export interface SnapshotGroup {
  type: "group";
  operator: GroupOperator;
  conditions: SnapshotCondition[];
  enabled?: boolean;
}

export type SnapshotCondition = SnapshotRule | SnapshotGroup;

export interface StrategySnapshot {
  name: string;
  entry: SnapshotCondition;
  exit: SnapshotCondition;
}

export interface BacktestRunRecord extends BacktestRunSummary {
  strategy_snapshot: StrategySnapshot;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTrade[];
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

export function listIndicatorCatalog() {
  return fetchJson<IndicatorDefinition[]>("/api/v1/indicators");
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

function generateNodeId() {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The backend stores conditions without ids, so attach fresh ones on load to
// give the rule builder stable React keys.
function withNodeIds(condition: StrategyCondition): StrategyCondition {
  if (condition.type === "group") {
    return {
      ...condition,
      id: generateNodeId(),
      conditions: condition.conditions.map(withNodeIds),
    };
  }
  return { ...condition, id: generateNodeId() };
}

function withRecordNodeIds(record: StrategyRecord): StrategyRecord {
  return { ...record, entry: withNodeIds(record.entry), exit: withNodeIds(record.exit) };
}

export async function listStrategies() {
  const records = await fetchJson<StrategyRecord[]>("/api/v1/strategies");
  return records.map(withRecordNodeIds);
}

export async function createStrategy(draft: StrategyDraft) {
  const record = await fetchJson<StrategyRecord>("/api/v1/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return withRecordNodeIds(record);
}

export async function updateStrategy(id: number, draft: StrategyDraft) {
  const record = await fetchJson<StrategyRecord>(`/api/v1/strategies/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  return withRecordNodeIds(record);
}

export function deleteStrategy(id: number) {
  return fetchJson<{ id: number; deleted: boolean }>(`/api/v1/strategies/${id}`, {
    method: "DELETE",
  });
}

export function validateStrategy(draft: StrategyDraft) {
  return fetchJson<StrategyValidationResult>("/api/v1/strategies/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export function generateSignals(options: {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  strategy: StrategyDraft;
}) {
  return fetchJson<{ signals: StrategySignal[] }>("/api/v1/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: options.ticker,
      timeframe: options.timeframe,
      start_ms: options.startMs,
      end_ms: options.endMs,
      strategy: options.strategy,
    }),
  });
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
