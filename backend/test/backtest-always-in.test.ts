import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "../src/services/backtest.ts";
import { bar, closeRule, strategy } from "./backtestFixtures.ts";

test("runBacktest always_in shorts from flat and profits when the price falls", () => {
  const candles = [
    bar(0, 10, 4), // sell signal while flat -> queue a short
    bar(1, 10, 4), // short fills at 10 (100 shares, cash-secured)
    bar(2, 6, 20), // buy signal on close
    bar(3, 5, 5), // buy fills at 5: cover +500 pnl, then flip 100% long
  ];

  const result = runBacktest({
    positionMode: "always_in",
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.equal(result.trades.length, 2);
  const [short, flip] = result.trades;

  assert.equal(short.side, "sell");
  assert.equal(short.price, 10);
  assert.equal(short.shares, 100);
  assert.equal(short.shares_after, -100);
  assert.equal(short.cash_after, 2_000);
  assert.equal(short.realized_pnl, null);

  // Cover 100 shares and open a 300-share long in one fill.
  assert.equal(flip.side, "buy");
  assert.equal(flip.price, 5);
  assert.equal(flip.shares, 400);
  assert.equal(flip.shares_after, 300);
  assert.equal(flip.cash_after, 0);
  assert.equal(flip.realized_pnl, 500);

  // Shorted at 10, covered at 5: a 50% drop earns 50%.
  assert.equal(result.metrics.final_equity, 1_500);
  assert.equal(result.metrics.total_return_pct, 50);
  assert.equal(result.metrics.win_rate_pct, 100);

  // The equity curve reports the short as negative shares/position value.
  const whileShort = result.equity_curve[1];
  assert.equal(whileShort.shares, -100);
  assert.equal(whileShort.position_value, -400);
  assert.equal(whileShort.equity, 1_600);
});

test("runBacktest always_in flips an open long straight into a full short", () => {
  const candles = [
    bar(0, 10, 20), // buy signal
    bar(1, 10, 3), // long fills at 10; sell signal on close
    bar(2, 12, 12), // flip fills at 12: close long +200, short 100 shares
  ];

  const result = runBacktest({
    positionMode: "always_in",
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.equal(result.trades.length, 2);
  const flip = result.trades[1];
  assert.equal(flip.side, "sell");
  assert.equal(flip.shares, 200); // 100 closed + 100 shorted
  assert.equal(flip.shares_after, -100);
  assert.equal(flip.cash_after, 2_400);
  assert.equal(flip.realized_pnl, 200);

  assert.equal(result.metrics.final_equity, 1_200);
  assert.equal(result.metrics.win_rate_pct, 100);
});

test("runBacktest always_in ignores repeated signals in the held direction", () => {
  const candles = [
    bar(0, 10, 4), // sell signal
    bar(1, 10, 4), // short fills; sell fires again while short -> ignored
    bar(2, 10, 4), // still short, no extra trades
    bar(3, 10, 4),
  ];

  const result = runBacktest({
    positionMode: "always_in",
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].side, "sell");
});
