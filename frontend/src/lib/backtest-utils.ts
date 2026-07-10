import type { BacktestRunRecord, BacktestRunSummary, BacktestTrade } from "@/lib/api";
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

/**
 * Fills targeting cash (the three_state go-to-cash tree) show as a neutral
 * "cash" event rather than the buy/sell direction of the underlying fill.
 */
export function tradeDisplaySide(trade: BacktestTrade): "buy" | "sell" | "cash" {
  return trade.target === "cash" ? "cash" : trade.side;
}

export function formatRunRange(run: BacktestRunSummary) {
  return `${formatDate(run.start_ms, "1d")} – ${formatDate(run.end_ms, "1d")}`;
}

export function formatRunSizing(run: BacktestRunSummary) {
  if (run.position_mode === "always_in") {
    return "always in market (100% flips)";
  }
  if (run.position_mode === "three_state") {
    return "three-state (100% long / short / cash)";
  }
  return `buy ${run.buy_percent}% / sell ${run.sell_percent}%`;
}

// Hoisted: Intl constructors are expensive to rebuild per call.
const ranAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatRanAt(createdAt: string) {
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const ms = Date.parse(createdAt.includes("Z") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(ms)) {
    return createdAt;
  }
  return ranAtFormat.format(new Date(ms));
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

/**
 * Theoretically optimal curve: perfect foresight holding a fixed number of
 * shares (sized to the starting capital) long or short to capture every bar's
 * move. It is the upper bound a fixed-size strategy could reach, so it only
 * ever rises.
 */
export function optimalCurve(points: ComparisonPoint[], initialCapital: number) {
  const first = points.find((point) => point.close > 0);
  if (!first) {
    return [];
  }
  const shares = initialCapital / first.close;
  let equity = initialCapital;
  return points.map((point, index) => {
    if (index > 0) {
      equity += shares * Math.abs(point.close - points[index - 1].close);
    }
    return { timestamp_ms: point.timestamp_ms, value: equity };
  });
}

export interface SeriesMetrics {
  totalReturnPct: number;
  maxDrawdownPct: number;
  finalValue: number;
}

/** Total return and worst peak-to-trough drawdown of an equity value series. */
export function seriesMetrics(values: number[], initialCapital: number): SeriesMetrics | null {
  if (values.length === 0) {
    return null;
  }
  let peak = values[0];
  let maxDrawdownPct = 0;
  for (const value of values) {
    if (value > peak) {
      peak = value;
    }
    const drawdownPct = (value / peak - 1) * 100;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
    }
  }
  const finalValue = values[values.length - 1];
  return {
    totalReturnPct: (finalValue / initialCapital - 1) * 100,
    maxDrawdownPct,
    finalValue,
  };
}
