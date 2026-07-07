import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSignals } from "../src/services/signals.ts";
import type { Candle, Strategy, StrategyCondition } from "../src/types.ts";

function candle(index: number, close: number, high = close + 1, low = close - 1): Candle {
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

function strategy(entry: StrategyCondition, exit: StrategyCondition): Strategy {
  return { name: "Test", entry, exit };
}

const never: StrategyCondition = {
  type: "rule",
  left: { type: "price", field: "close" },
  operator: "lt",
  right: { type: "value", value: -1 },
};

test("evaluateSignals emits simple gt buy rules and preserves duplicate triggers", () => {
  const candles = [1, 3, 4, 2].map((close, index) => candle(index, close));
  const signals = evaluateSignals(
    strategy(
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 2 },
      },
      never,
    ),
    candles,
  );

  assert.deepEqual(signals, [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
    { timestamp_ms: candles[2].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals handles cross_above and cross_below equality boundaries", () => {
  const aboveCandles = [9, 10, 11].map((close, index) => candle(index, close));
  const belowCandles = [11, 10, 9].map((close, index) => candle(index, close));
  const crossAbove: StrategyCondition = {
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "cross_above",
    right: { type: "value", value: 10 },
  };
  const crossBelow: StrategyCondition = {
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "cross_below",
    right: { type: "value", value: 10 },
  };

  assert.deepEqual(evaluateSignals(strategy(crossAbove, never), aboveCandles), [
    { timestamp_ms: aboveCandles[2].timestamp_ms, side: "buy" },
  ]);
  assert.deepEqual(evaluateSignals(strategy(never, crossBelow), belowCandles), [
    { timestamp_ms: belowCandles[2].timestamp_ms, side: "sell" },
  ]);
});

test("evaluateSignals does not cross through indicator warm-up nulls", () => {
  const candles = [1, 2, 3].map((close, index) => candle(index, close));
  const rule: StrategyCondition = {
    type: "rule",
    left: { type: "indicator", kind: "sma", parameters: { period: 3 }, output: "sma" },
    operator: "cross_above",
    right: { type: "value", value: 1 },
  };

  assert.deepEqual(evaluateSignals(strategy(rule, never), candles), []);
});

test("evaluateSignals evaluates and/or/not groups", () => {
  const candles = [1, 3, 6].map((close, index) => candle(index, close));
  const entry: StrategyCondition = {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "group",
        operator: "or",
        conditions: [
          {
            type: "rule",
            left: { type: "price", field: "close" },
            operator: "lt",
            right: { type: "value", value: 2 },
          },
          {
            type: "rule",
            left: { type: "price", field: "close" },
            operator: "gt",
            right: { type: "value", value: 5 },
          },
        ],
      },
      {
        type: "group",
        operator: "not",
        conditions: [
          {
            type: "rule",
            left: { type: "price", field: "close" },
            operator: "gte",
            right: { type: "value", value: 2 },
          },
        ],
      },
    ],
  };

  assert.deepEqual(evaluateSignals(strategy(entry, never), candles), [
    { timestamp_ms: candles[0].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals skips disabled rules as if they were deleted", () => {
  const candles = [1, 3, 6].map((close, index) => candle(index, close));
  const entry: StrategyCondition = {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 2 },
      },
      {
        // Enabled it would reject close=3; disabled it must not block the buy.
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 5 },
        enabled: false,
      },
    ],
  };

  assert.deepEqual(evaluateSignals(strategy(entry, never), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
    { timestamp_ms: candles[2].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals never fires a side whose conditions are all disabled", () => {
  const candles = [1, 3].map((close, index) => candle(index, close));
  const alwaysDisabled: StrategyCondition = {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 0 },
        enabled: false,
      },
    ],
  };

  // An empty AND group would otherwise be vacuously true every candle.
  assert.deepEqual(evaluateSignals(strategy(alwaysDisabled, never), candles), []);
});

test("evaluateSignals drops NOT groups whose only child is disabled", () => {
  const candles = [1, 3].map((close, index) => candle(index, close));
  const entry: StrategyCondition = {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 2 },
      },
      {
        // NOT(true) would block everything, but its child is disabled.
        type: "group",
        operator: "not",
        conditions: [
          {
            type: "rule",
            left: { type: "price", field: "close" },
            operator: "gt",
            right: { type: "value", value: 0 },
            enabled: false,
          },
        ],
      },
    ],
  };

  assert.deepEqual(evaluateSignals(strategy(entry, never), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals skips disabled groups entirely", () => {
  const candles = [1, 3].map((close, index) => candle(index, close));
  const entry: StrategyCondition = {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "value", value: 2 },
      },
      {
        type: "group",
        operator: "not",
        enabled: false,
        conditions: [
          {
            type: "rule",
            left: { type: "price", field: "close" },
            operator: "gt",
            right: { type: "value", value: 0 },
          },
        ],
      },
    ],
  };

  assert.deepEqual(evaluateSignals(strategy(entry, never), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals can emit buy and sell on the same candle", () => {
  const candles = [1, 3].map((close, index) => candle(index, close));
  const entry: StrategyCondition = {
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "gt",
    right: { type: "value", value: 2 },
  };
  const exit: StrategyCondition = {
    type: "rule",
    left: { type: "price", field: "high" },
    operator: "gt",
    right: { type: "value", value: 2 },
  };

  assert.deepEqual(evaluateSignals(strategy(entry, exit), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
    { timestamp_ms: candles[1].timestamp_ms, side: "sell" },
  ]);
});
