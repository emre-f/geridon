import { computeIndicatorValueSeries } from "../indicators.ts";
import type { Candle } from "../../types.ts";
import type { TradeEventRow } from "./tradeEvents.ts";

export const featureSetId = "meta-features-v1";

export const featureNames = [
  "rsi_14",
  "macd_hist_pct",
  "trend_slope_20",
  "atr_pct_14",
  "rvol_20",
  "bb_position_20_2",
] as const;

export type FeatureName = (typeof featureNames)[number];

export interface FeatureMatrix {
  feature_set_id: string;
  feature_names: FeatureName[];
  rows: Array<Array<number | null>>;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function computeFeatureSeries(
  candles: Candle[],
): Record<FeatureName, Array<number | null>> {
  const closes = candles.map((candle) => candle.close);
  const rsi = computeIndicatorValueSeries(candles, "rsi", { period: 14 }, "rsi");
  const macdHistogram = computeIndicatorValueSeries(
    candles,
    "macd",
    { fast: 12, slow: 26, signal: 9 },
    "histogram",
  );
  const sma = computeIndicatorValueSeries(candles, "sma", { period: 20 }, "sma");
  const atr = computeIndicatorValueSeries(candles, "atr", { period: 14 }, "atr");
  const rvol = computeIndicatorValueSeries(candles, "rvol", { period: 20 }, "rvol");
  const bbp = computeIndicatorValueSeries(candles, "bbp", { period: 20, stdDev: 2 }, "bbp");

  const trendSlope = candles.map((_, index) => {
    const now = sma[index];
    const before = index >= 5 ? sma[index - 5] : null;
    const slope = ratio(now == null || before == null ? null : now - before, before);
    return slope == null ? null : slope * 100;
  });

  return {
    rsi_14: rsi,
    macd_hist_pct: macdHistogram.map((value, index) => {
      const scaled = ratio(value, closes[index]);
      return scaled == null ? null : scaled * 100;
    }),
    trend_slope_20: trendSlope,
    atr_pct_14: atr.map((value, index) => {
      const scaled = ratio(value, closes[index]);
      return scaled == null ? null : scaled * 100;
    }),
    rvol_20: rvol,
    bb_position_20_2: bbp,
  };
}

export function buildFeatureMatrix(
  candles: Candle[],
  events: TradeEventRow[],
): FeatureMatrix {
  const series = computeFeatureSeries(candles);
  return {
    feature_set_id: featureSetId,
    feature_names: [...featureNames],
    rows: events.map((event) =>
      featureNames.map((name) => series[name][event.trigger_index] ?? null),
    ),
  };
}
