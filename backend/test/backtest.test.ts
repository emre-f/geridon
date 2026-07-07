import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "../src/services/backtest.ts";
import { bar, closeRule, strategy } from "./backtestFixtures.ts";

test("runBacktest fills signals at the next bar open, all-in all-out by default", () => {
  const candles = [
    bar(0, 10, 8), // no signal
    bar(1, 9, 12), // buy signal on close
    bar(2, 14, 15), // buy fills at open 14; close re-triggers buy (no cash left)
    bar(3, 16, 4), // pending buy skipped (no cash); sell signal on close
    bar(4, 6, 6), // sell fills at open 6
  ];

  const result = runBacktest({
    positionMode: "long_only" as const,
    strategy: strategy(closeRule("gt", 10), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
  });

  assert.equal(result.trades.length, 2);
  const [buy, sell] = result.trades;
  assert.equal(buy.side, "buy");
  assert.equal(buy.timestamp_ms, candles[2].timestamp_ms);
  assert.equal(buy.price, 14);
  assert.ok(Math.abs(buy.shares - 10_000 / 14) < 1e-9);
  assert.equal(buy.cash_after, 0);

  assert.equal(sell.side, "sell");
  assert.equal(sell.timestamp_ms, candles[4].timestamp_ms);
  assert.equal(sell.price, 6);
  assert.equal(sell.shares_after, 0);
  assert.ok(Math.abs((sell.realized_pnl ?? 0) - (6 - 14) * (10_000 / 14)) < 1e-9);

  const expectedFinal = (10_000 / 14) * 6;
  assert.ok(Math.abs(result.metrics.final_equity - expectedFinal) < 1e-9);
  assert.ok(Math.abs(result.metrics.total_return_pct - (expectedFinal / 10_000 - 1) * 100) < 1e-9);
  assert.equal(result.metrics.win_rate_pct, 0);
  assert.equal(result.metrics.candle_count, candles.length);
});

test("runBacktest sizes buys as % of equity and sells as % of position", () => {
  const candles = [
    bar(0, 10, 20), // buy signal
    bar(1, 10, 20), // buy fills at 10; buy signal again
    bar(2, 20, 20), // buy fills at 20 (pyramiding); buy signal again
    bar(3, 20, 4), // pending buy skipped (no cash); sell signal
    bar(4, 8, 8), // sell fills at 8
  ];

  const result = runBacktest({
    positionMode: "long_only" as const,
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 50,
    sellPercent: 50,
    initialCapital: 1_000,
  });

  assert.equal(result.trades.length, 3);
  const [firstBuy, secondBuy, sell] = result.trades;

  // First buy: 50% of 1000 equity at 10 -> 50 shares, 500 cash left.
  assert.equal(firstBuy.value, 500);
  assert.equal(firstBuy.shares, 50);
  assert.equal(firstBuy.cash_after, 500);

  // Second buy: equity at fill = 500 + 50 * 20 = 1500; 50% = 750 capped to 500 cash.
  assert.equal(secondBuy.value, 500);
  assert.equal(secondBuy.shares, 25);
  assert.equal(secondBuy.cash_after, 0);

  // Sell: 50% of the 75-share position at 8.
  assert.equal(sell.shares, 37.5);
  assert.equal(sell.value, 300);
  assert.equal(sell.shares_after, 37.5);
  // Average cost was 1000 / 75.
  assert.ok(Math.abs((sell.realized_pnl ?? 0) - (8 - 1_000 / 75) * 37.5) < 1e-9);

  assert.equal(result.metrics.final_equity, 600);

  // Equity curve tracks cash and position value on each close.
  const afterFirstBuy = result.equity_curve[1];
  assert.equal(afterFirstBuy.cash, 500);
  assert.equal(afterFirstBuy.shares, 50);
  assert.equal(afterFirstBuy.position_value, 1_000);
  assert.equal(afterFirstBuy.equity, 1_500);
});

test("runBacktest prioritizes exits on simultaneous signals and ignores sells while flat", () => {
  const candles = [
    bar(0, 10, 20), // entry + exit both true; flat, so only buy queues
    bar(1, 10, 20), // buy fills at 10; both true again -> sell queues
    bar(2, 12, 12), // sell fills at 12
  ];

  const result = runBacktest({
    positionMode: "long_only" as const,
    strategy: strategy(closeRule("gt", 15), closeRule("gt", 18)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.deepEqual(
    result.trades.map((trade) => trade.side),
    ["buy", "sell"],
  );
  assert.equal(result.metrics.final_equity, 1_200);
  assert.equal(result.metrics.win_rate_pct, 100);
});

test("runBacktest drops a signal on the final bar because there is no bar to fill it", () => {
  const candles = [bar(0, 10, 8), bar(1, 9, 20)];

  const result = runBacktest({
    positionMode: "long_only" as const,
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  });

  assert.equal(result.trades.length, 0);
  assert.equal(result.metrics.final_equity, 1_000);
  assert.equal(result.metrics.win_rate_pct, null);
});

test("runBacktest rejects invalid sizing and capital", () => {
  const candles = [bar(0, 10, 10)];
  const base = {
    positionMode: "long_only" as const,
    strategy: strategy(closeRule("gt", 15), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 1_000,
  };

  assert.throws(() => runBacktest({ ...base, buyPercent: 0 }), /buy_percent/);
  assert.throws(() => runBacktest({ ...base, sellPercent: 101 }), /sell_percent/);
  assert.throws(() => runBacktest({ ...base, initialCapital: 0 }), /initial_capital/);
});
