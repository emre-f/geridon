import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSignals } from "../src/services/signals.ts";
import type { StrategyCondition } from "../src/types.ts";
import { candle, neverCondition, strategy } from "./signalFixtures.ts";

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

  assert.deepEqual(evaluateSignals(strategy(entry, neverCondition), candles), [
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
  assert.deepEqual(evaluateSignals(strategy(alwaysDisabled, neverCondition), candles), []);
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

  assert.deepEqual(evaluateSignals(strategy(entry, neverCondition), candles), [
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

  assert.deepEqual(evaluateSignals(strategy(entry, neverCondition), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
  ]);
});

test("evaluateSignals clamps at_least count when children are disabled", () => {
  const candles = [1, 3].map((close, index) => candle(index, close));
  const closeAbove = (value: number, enabled?: false): StrategyCondition => ({
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "gt",
    right: { type: "value", value },
    ...(enabled === false ? { enabled } : {}),
  });
  const entry: StrategyCondition = {
    type: "group",
    operator: "at_least",
    count: 2,
    conditions: [closeAbove(2), closeAbove(100, false), closeAbove(200, false)],
  };

  // A literal 2-of-1 could never fire; disabling must act like deleting,
  // so the group evaluates as 1-of-1.
  assert.deepEqual(evaluateSignals(strategy(entry, neverCondition), candles), [
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
  ]);
});
