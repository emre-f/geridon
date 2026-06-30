import assert from "node:assert/strict";
import test from "node:test";

import { aggregateHourlyCandles } from "../src/services/aggregation.ts";
import type { Candle } from "../src/types.ts";

function candle(
  timestamp_ms: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  vwap: number,
  transactions: number,
): Candle {
  return {
    ticker: "AAPL",
    multiplier: 1,
    timespan: "hour",
    timestamp_ms,
    open,
    high,
    low,
    close,
    volume,
    vwap,
    transactions,
  };
}

test("aggregateHourlyCandles rolls OHLCV into day", () => {
  const candles = [
    candle(1704128400000, 10, 12, 9, 11, 100, 10.5, 2),
    candle(1704132000000, 11, 15, 10, 14, 300, 13.5, 3),
  ];

  const [daily] = aggregateHourlyCandles(candles, "1d");

  assert.equal(daily.open, 10);
  assert.equal(daily.high, 15);
  assert.equal(daily.low, 9);
  assert.equal(daily.close, 14);
  assert.equal(daily.volume, 400);
  assert.equal(daily.vwap, 12.75);
  assert.equal(daily.transactions, 5);
});
