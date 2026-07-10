import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "../src/services/backtest.ts";
import type { Strategy, StrategyCondition } from "../src/types.ts";
import { bar, closeRule } from "./backtestFixtures.ts";

const cashBetween: StrategyCondition = {
  type: "group",
  operator: "and",
  conditions: [closeRule("gt", 5), closeRule("lt", 15)],
};

test("runBacktest three_state cycles long -> cash -> short -> cash", () => {
  const strategy: Strategy = {
    name: "Three state",
    entry: closeRule("gt", 15), // long
    exit: closeRule("lt", 5), // short
    cash: cashBetween, // cash
  };
  const candles = [
    bar(0, 10, 20), // long signal while flat -> queue long
    bar(1, 10, 10), // long fills at 10; close 10 is the cash band -> queue cash
    bar(2, 12, 4), // flatten long at 12 (+200); close 4 -> queue short
    bar(3, 8, 8), // short fills at 8; close 8 is the cash band -> queue cash
    bar(4, 10, 10), // cover short at 10 (-300)
  ];

  const result = runBacktest({
    positionMode: "three_state",
    strategy,
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.deepEqual(
    result.trades.map((trade) => [trade.side, trade.price, trade.realized_pnl]),
    [
      ["buy", 10, null], // enter long
      ["sell", 12, 200], // flatten long
      ["sell", 8, null], // enter short
      ["buy", 10, -300], // cover short
    ],
  );
  assert.deepEqual(
    result.trades.map((trade) => trade.target),
    ["long", "cash", "short", "cash"],
  );
  assert.equal(result.trades[0].shares_after, 100);
  assert.equal(result.trades[2].shares_after, -150);
  assert.equal(result.metrics.final_equity, 900);
});

test("at_least fires only when the required number of conditions hold", () => {
  const entry: StrategyCondition = {
    type: "group",
    operator: "at_least",
    count: 2,
    conditions: [closeRule("gt", 5), closeRule("gt", 15), closeRule("gt", 100)],
  };
  const strategy: Strategy = { name: "Vote", entry, exit: closeRule("lt", 0) };
  const candles = [
    bar(0, 10, 20), // >5 and >15 -> 2 of 3 -> buy
    bar(1, 10, 10), // buy fills at 10
  ];

  const twoOfThree = runBacktest({
    positionMode: "long_only",
    strategy,
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });
  assert.equal(twoOfThree.trades.length, 1);
  assert.equal(twoOfThree.trades[0].side, "buy");

  const threeOfThree = runBacktest({
    positionMode: "long_only",
    strategy: { ...strategy, entry: { ...entry, count: 3 } },
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });
  assert.equal(threeOfThree.trades.length, 0);
});
