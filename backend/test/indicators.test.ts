import assert from "node:assert/strict";
import test from "node:test";

import { computeIndicators, normalizeIndicatorSpecs } from "../src/services/indicators.ts";
import type { CandleResponse, IndicatorSeriesResponse } from "../src/types.ts";

function candle(index: number, close: number, high = close + 1, low = close - 1): CandleResponse {
  return {
    ticker: "AAPL",
    timeframe: "1d",
    timestamp_ms: 1700000000000 + index * 86_400_000,
    timestamp: new Date(1700000000000 + index * 86_400_000).toISOString(),
    open: close,
    high,
    low,
    close,
    volume: 100,
    vwap: close,
    transactions: 1,
  };
}

function seriesValue(series: IndicatorSeriesResponse, key: string) {
  return series.points.map((point) => point.values[key]);
}

test("computeIndicators calculates SMA and EMA with period warmup", () => {
  const candles = [1, 2, 3, 4, 5].map((close, index) => candle(index, close));
  const specs = normalizeIndicatorSpecs([
    { kind: "sma", parameters: { period: 3 } },
    { kind: "ema", parameters: { period: 3 } },
  ]);

  const [sma, ema] = computeIndicators(candles, specs);

  assert.deepEqual(seriesValue(sma, "sma"), [null, null, 2, 3, 4]);
  assert.deepEqual(seriesValue(ema, "ema"), [null, null, 2, 3, 4]);
});

test("computeIndicators calculates RSI, Bollinger Bands, ATR, and MACD", () => {
  const candles = [1, 2, 3, 4, 5, 6].map((close, index) => candle(index, close));
  const specs = normalizeIndicatorSpecs([
    { kind: "rsi", parameters: { period: 2 } },
    { kind: "bollinger", parameters: { period: 2, stdDev: 2 } },
    { kind: "atr", parameters: { period: 2 } },
    { kind: "macd", parameters: { fast: 2, slow: 3, signal: 2 } },
  ]);

  const [rsi, bollinger, atr, macd] = computeIndicators(candles, specs);

  assert.deepEqual(seriesValue(rsi, "rsi"), [null, null, 100, 100, 100, 100]);
  assert.deepEqual(seriesValue(bollinger, "middle"), [null, 1.5, 2.5, 3.5, 4.5, 5.5]);
  assert.deepEqual(seriesValue(bollinger, "upper"), [null, 2.5, 3.5, 4.5, 5.5, 6.5]);
  assert.deepEqual(seriesValue(bollinger, "lower"), [null, 0.5, 1.5, 2.5, 3.5, 4.5]);
  assert.deepEqual(seriesValue(atr, "atr"), [null, 2, 2, 2, 2, 2]);
  assert.equal(seriesValue(macd, "histogram").at(-1) == null, false);
});
