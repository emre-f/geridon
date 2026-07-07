import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSignals } from "../src/services/signals.ts";
import type { StrategyCondition } from "../src/types.ts";
import { candle, neverCondition, strategy } from "./signalFixtures.ts";

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
      neverCondition,
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

  assert.deepEqual(evaluateSignals(strategy(crossAbove, neverCondition), aboveCandles), [
    { timestamp_ms: aboveCandles[2].timestamp_ms, side: "buy" },
  ]);
  assert.deepEqual(evaluateSignals(strategy(neverCondition, crossBelow), belowCandles), [
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

  assert.deepEqual(evaluateSignals(strategy(rule, neverCondition), candles), []);
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

  assert.deepEqual(evaluateSignals(strategy(entry, neverCondition), candles), [
    { timestamp_ms: candles[0].timestamp_ms, side: "buy" },
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
