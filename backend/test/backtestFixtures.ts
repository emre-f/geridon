import type { Candle, Strategy, StrategyCondition } from "../src/types.ts";

export function bar(index: number, open: number, close: number): Candle {
  const high = Math.max(open, close) + 1;
  const low = Math.min(open, close) - 1;
  return {
    ticker: "AAPL",
    multiplier: 1,
    timespan: "day",
    timestamp_ms: 1700000000000 + index * 86_400_000,
    open,
    high,
    low,
    close,
    volume: 100,
    vwap: close,
    transactions: 1,
  };
}

export function closeRule(operator: "gt" | "lt", value: number): StrategyCondition {
  return {
    type: "rule",
    left: { type: "price", field: "close" },
    operator,
    right: { type: "value", value },
  };
}

export function strategy(entry: StrategyCondition, exit: StrategyCondition): Strategy {
  return { name: "Test", entry, exit };
}
