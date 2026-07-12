import type { Database } from "../db.ts";
import { holdoutCandleCount } from "../services/optimization/holdout.ts";
import { parseTimeframe } from "../timeframes.ts";
import type {
  ExperimentDatasetSpec,
  HoldoutConfig,
  OptimizationDataset,
  OptimizationExperimentConfig,
} from "../types.ts";
import { candlesForTimeframe, responseToCandle } from "./shared.ts";

export function loadExperimentDatasets(
  db: Database,
  config: OptimizationExperimentConfig,
): OptimizationDataset[] {
  const timeframe = parseTimeframe(config.timeframe);
  return config.tickers.map((ticker) => {
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
    return { symbol: ticker, candles };
  });
}

export function datasetSpecs(
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
  }));
}
