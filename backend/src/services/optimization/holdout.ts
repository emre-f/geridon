import type { FoldSpec, HoldoutConfig, OptimizationDataset } from "../../types.ts";

export const holdoutLimits = { minFraction: 0.05, maxFraction: 0.4, minCandles: 5 };

export function holdoutCandleCount(candleCount: number, holdout: HoldoutConfig | undefined): number {
  if (!holdout) {
    return 0;
  }
  return Math.floor(candleCount * holdout.fraction);
}

/**
 * The search portion of each dataset: everything before the sealed trailing
 * window. The optimizer must only ever receive these slices, and events that
 * became available in the holdout window are sealed with it — otherwise they
 * would anchor to the last search bar.
 */
export function searchDatasets(
  datasets: OptimizationDataset[],
  holdout: HoldoutConfig | undefined,
): OptimizationDataset[] {
  if (!holdout) {
    return datasets;
  }
  return datasets.map((dataset) => {
    const candles = dataset.candles.slice(
      0,
      dataset.candles.length - holdoutCandleCount(dataset.candles.length, holdout),
    );
    const holdoutStartMs = dataset.candles[candles.length]?.timestamp_ms;
    return {
      ...dataset,
      candles,
      ...(dataset.events && holdoutStartMs != null
        ? { events: dataset.events.filter((event) => event.available_ts_ms < holdoutStartMs) }
        : {}),
    };
  });
}

/**
 * One fold over the full dataset whose validation window is the sealed
 * trailing candles; the whole search portion warms up indicators.
 */
export function holdoutFoldSpec(candleCount: number, holdoutCount: number): FoldSpec {
  const validStartIndex = candleCount - holdoutCount;
  return {
    index: 0,
    trainStartIndex: 0,
    trainEndIndex: validStartIndex - 1,
    validStartIndex,
    validEndIndex: candleCount - 1,
  };
}

export function validateHoldoutSize(
  symbol: string,
  candleCount: number,
  holdout: HoldoutConfig,
): string | null {
  const count = holdoutCandleCount(candleCount, holdout);
  if (count < holdoutLimits.minCandles) {
    return (
      `${symbol}: the sealed holdout would cover only ${count} candles ` +
      `(minimum ${holdoutLimits.minCandles}).`
    );
  }
  return null;
}
