import assert from "node:assert/strict";
import test from "node:test";

import { normalizeYahooChartResult } from "../src/yahooClient.ts";
import { supportedTimeframes } from "../src/timeframes.ts";

test("normalizeYahooChartResult converts Yahoo hourly rows into market candles", () => {
  const [candle] = normalizeYahooChartResult(
    {
      timestamp: [1704128400],
      indicators: {
        quote: [
          {
            open: [10],
            high: [12],
            low: [9],
            close: [11],
            volume: [100],
          },
        ],
      },
    },
    supportedTimeframes["1h"],
    true,
  );

  assert.deepEqual(candle, {
    timestamp_ms: 1704128400000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
    vwap: null,
    transactions: null,
  });
});

test("normalizeYahooChartResult adjusts daily OHLC and skips incomplete rows", () => {
  const candles = normalizeYahooChartResult(
    {
      timestamp: [1704159000, 1704245400],
      indicators: {
        quote: [
          {
            open: [100, null],
            high: [110, 12],
            low: [90, 9],
            close: [100, 11],
            volume: [1000, 100],
          },
        ],
        adjclose: [{ adjclose: [50, 10] }],
      },
    },
    supportedTimeframes["1d"],
    true,
  );

  assert.deepEqual(candles, [
    {
      timestamp_ms: Date.UTC(2024, 0, 2),
      open: 50,
      high: 55,
      low: 45,
      close: 50,
      volume: 1000,
      vwap: null,
      transactions: null,
    },
  ]);
});
