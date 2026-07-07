import type { Candle, Strategy, StrategyCondition } from "../src/types.ts";

export function candle(index: number, close: number, high = close + 1, low = close - 1): Candle {
  return {
    ticker: "AAPL",
    multiplier: 1,
    timespan: "day",
    timestamp_ms: 1700000000000 + index * 86_400_000,
    open: close,
    high,
    low,
    close,
    volume: 100,
    vwap: close,
    transactions: 1,
  };
}

export function strategy(entry: StrategyCondition, exit: StrategyCondition): Strategy {
  return { name: "Test", entry, exit };
}

export const neverCondition: StrategyCondition = {
  type: "rule",
  left: { type: "price", field: "close" },
  operator: "lt",
  right: { type: "value", value: -1 },
};
