import type {
  Candle,
  OptimizationConfig,
  OptimizationDataset,
  Strategy,
  StrategyCondition,
} from "../src/types.ts";

export function candle(index: number, open: number, close: number): Candle {
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.5;
  return {
    ticker: "TEST",
    multiplier: 1,
    timespan: "day",
    timestamp_ms: 1600000000000 + index * 86_400_000,
    open,
    high,
    low,
    close,
    volume: 1000,
    vwap: close,
    transactions: 10,
  };
}

/** Triangle wave between 90 and 110 with a 20-bar cycle. */
export function triangleClose(index: number): number {
  const phase = index % 20;
  return 90 + 2 * Math.min(phase, 20 - phase);
}

export function triangleCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const open = index === 0 ? triangleClose(0) : triangleClose(index - 1);
    candles.push(candle(index, open, triangleClose(index)));
  }
  return candles;
}

export function thresholdRule(
  operator: "gt" | "lt",
  value: number,
  enabled?: boolean,
): StrategyCondition {
  return {
    type: "rule",
    left: { type: "price", field: "close" },
    operator,
    right: { type: "value", value },
    ...(enabled === undefined ? {} : { enabled }),
  };
}

export function thresholdStrategy(entryBelow: number, exitAbove: number): Strategy {
  return {
    name: "Threshold",
    entry: thresholdRule("lt", entryBelow),
    exit: thresholdRule("gt", exitAbove),
  };
}

export function dataset(count = 400): OptimizationDataset {
  return { symbol: "TEST", candles: triangleCandles(count) };
}

/**
 * Three regimes over 480 candles: a fast wide triangle (90..110, 20-bar cycle),
 * a slow medium triangle (94..106, 40-bar cycle), and a fast narrow triangle
 * (97..102, 10-bar cycle). Buying below 98 and selling above 101.9 is
 * profitable in every regime; buying below 91 only ever triggers in the first.
 */
export function regimeClose(index: number): number {
  if (index < 160) {
    const phase = index % 20;
    return 90 + 2 * Math.min(phase, 20 - phase);
  }
  if (index < 320) {
    const phase = (index - 160) % 40;
    return 94 + 0.6 * Math.min(phase, 40 - phase);
  }
  const phase = (index - 320) % 10;
  return 97 + Math.min(phase, 10 - phase);
}

export function regimeDataset(): OptimizationDataset {
  const candles: Candle[] = [];
  for (let index = 0; index < 480; index += 1) {
    const open = index === 0 ? regimeClose(0) : regimeClose(index - 1);
    candles.push(candle(index, open, regimeClose(index)));
  }
  return { symbol: "TEST", candles };
}

export function baseConfig(strategy: Strategy, overrides?: Partial<OptimizationConfig>): OptimizationConfig {
  return {
    strategy,
    datasets: [dataset()],
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    seed: 42,
    maxTrials: 24,
    folds: { foldCount: 4, mode: "anchored" },
    scoring: {
      objective: "total_return",
      constraints: { minTotalTrades: 2, maxDrawdownPct: 90, minPositiveFoldFraction: 0.5 },
    },
    ...overrides,
  };
}
