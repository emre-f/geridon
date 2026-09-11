import type { Database } from "../db.ts";
import { getEvents } from "../services/eventStore.ts";
import { holdoutCandleCount } from "../services/optimization/holdout.ts";
import { collectSignalKinds } from "../services/signalSeries.ts";
import { parseTimeframe } from "../timeframes.ts";
import type {
  ExperimentDatasetSpec,
  HoldoutConfig,
  OptimizationDataset,
  OptimizationExperimentConfig,
  Strategy,
} from "../types.ts";
import { candlesForTimeframe, responseToCandle } from "./shared.ts";

// No event start bound on purpose: history before the range feeds days_since,
// matching the backtest API's fetch.
export function loadExperimentDatasets(
  db: Database,
  config: OptimizationExperimentConfig,
  strategy: Strategy,
): OptimizationDataset[] {
  const timeframe = parseTimeframe(config.timeframe);
  const signalKinds = collectSignalKinds(strategy);
  const datasets = config.tickers.map((ticker) => {
    const candles = candlesForTimeframe(db, {
      ticker,
      timeframe,
      startMs: config.start_ms,
      endMs: config.end_ms,
      limit: 50_000,
    }).map(responseToCandle);
    if (candles.length === 0) {
      throw new Error(`No stored ${timeframe.key} candles for ${ticker} in the requested range.`);
    }
    if (signalKinds.length === 0) {
      return { symbol: ticker, candles };
    }
    return {
      symbol: ticker,
      candles,
      events: getEvents(db, { kinds: signalKinds, ticker, endMs: config.end_ms }),
    };
  });
  if (signalKinds.length > 0 && datasets.every((dataset) => dataset.events?.length === 0)) {
    throw new Error(
      `No stored ${signalKinds.join(", ")} events for ${config.tickers.join(", ")}; ` +
        "the strategy's signal rules can never fire.",
    );
  }
  return datasets;
}

/**
 * The recorded dividend/split decision for optimization experiments: stored
 * candles are evaluated exactly as synced. Yahoo syncs default to back-adjusting
 * OHLC for splits and dividends via adjclose; Polygon syncs are split-adjusted.
 * The simulator applies no further adjustment, so total returns on unadjusted
 * or split-only data understate dividend income.
 */
export const priceAdjustmentNote =
  "Candles are used as stored from the sync source (Yahoo: split- and dividend-adjusted by default; Polygon: split-adjusted). No further dividend or split adjustment is applied during evaluation.";

function candleSources(
  db: Database,
  ticker: string,
  startMs: number,
  endMs: number,
): string[] {
  const rows = db
    .prepare(
      "SELECT DISTINCT source FROM candles WHERE ticker = ? AND timestamp_ms >= ? AND timestamp_ms <= ? ORDER BY source",
    )
    .all(ticker, startMs, endMs) as Array<{ source: string }>;
  return rows.map((row) => String(row.source));
}

export function datasetSpecs(
  db: Database,
  datasets: OptimizationDataset[],
  holdout?: HoldoutConfig,
): ExperimentDatasetSpec[] {
  return datasets.map((dataset) => ({
    ticker: dataset.symbol,
    candle_count: dataset.candles.length,
    first_candle_ms: dataset.candles[0].timestamp_ms,
    last_candle_ms: dataset.candles[dataset.candles.length - 1].timestamp_ms,
    ...(holdout
      ? { holdout_candle_count: holdoutCandleCount(dataset.candles.length, holdout) }
      : {}),
    sources: candleSources(
      db,
      dataset.symbol,
      dataset.candles[0].timestamp_ms,
      dataset.candles[dataset.candles.length - 1].timestamp_ms,
    ),
  }));
}
