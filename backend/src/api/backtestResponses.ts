import type {
  BacktestMetrics,
  BacktestPositionMode,
  BacktestResult,
  BacktestRunRecord,
  BacktestRunSummary,
  Strategy,
} from "../types.ts";

/**
 * Whether a run's stored snapshot still evaluates the same rules as the
 * strategy's current definition. Renames don't count: only the entry and
 * exit trees decide the trades. Both JSON strings are produced by
 * JSON.stringify over objects built by validateStrategy, so key order is
 * stable and stringify comparison is exact.
 */
export function snapshotMatchesDefinition(snapshotJson: string, definitionJson: string): boolean {
  const snapshot = JSON.parse(snapshotJson) as Strategy;
  const definition = JSON.parse(definitionJson) as Strategy;
  return (
    JSON.stringify(snapshot.entry) === JSON.stringify(definition.entry) &&
    JSON.stringify(snapshot.exit) === JSON.stringify(definition.exit)
  );
}

export function backtestRunSummary(
  row: Record<string, unknown>,
  strategyOutdated: boolean,
): BacktestRunSummary {
  return {
    id: Number(row.id),
    strategy_id: Number(row.strategy_id),
    ticker: String(row.ticker),
    timeframe: String(row.timeframe),
    start_ms: Number(row.start_ms),
    end_ms: Number(row.end_ms),
    position_mode: (row.position_mode ?? "long_only") as BacktestPositionMode,
    buy_percent: Number(row.buy_percent),
    sell_percent: Number(row.sell_percent),
    initial_capital: Number(row.initial_capital),
    metrics: JSON.parse(String(row.metrics)) as BacktestMetrics,
    strategy_outdated: strategyOutdated,
    created_at: String(row.created_at),
  };
}

export function backtestRunRecord(
  row: Record<string, unknown>,
  strategyOutdated: boolean,
): BacktestRunRecord {
  const detail = JSON.parse(String(row.detail)) as Pick<BacktestResult, "equity_curve" | "trades">;
  return {
    ...backtestRunSummary(row, strategyOutdated),
    strategy_snapshot: JSON.parse(String(row.strategy_snapshot)) as Strategy,
    equity_curve: detail.equity_curve,
    trades: detail.trades,
  };
}
