import type { BacktestRunRecord, BacktestRunSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";

export interface ComparisonPoint {
  timestamp_ms: number;
  close: number;
}

export function toDateInputValue(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayStartMs(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

export function dayEndMs(value: string) {
  return Date.parse(`${value}T23:59:59.999Z`);
}

export function formatRunRange(run: BacktestRunSummary) {
  return `${formatDate(run.start_ms, "1d")} – ${formatDate(run.end_ms, "1d")}`;
}

export function formatRunSizing(run: BacktestRunSummary) {
  return run.position_mode === "always_in"
    ? "always in market (100% flips)"
    : `buy ${run.buy_percent}% / sell ${run.sell_percent}%`;
}

export function formatRanAt(createdAt: string) {
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const ms = Date.parse(createdAt.includes("Z") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(ms)) {
    return createdAt;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function comparisonCacheKey(ticker: string, run: BacktestRunRecord) {
  return `${ticker}|${run.timeframe}|${run.start_ms}|${run.end_ms}`;
}

export function createComparisonId() {
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Buy-and-hold curve: the run's starting capital riding the ticker's closes. */
export function holdCurve(points: ComparisonPoint[], initialCapital: number) {
  const first = points.find((point) => point.close > 0);
  if (!first) {
    return [];
  }
  return points.map((point) => ({
    timestamp_ms: point.timestamp_ms,
    value: (initialCapital * point.close) / first.close,
  }));
}
