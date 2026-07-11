import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "../src/services/backtest.ts";
import { bar, closeRule, strategy } from "./backtestFixtures.ts";

// Buy fills at open 14 on bar 2, sell fills at open 6 on bar 4.
const candles = [bar(0, 10, 8), bar(1, 9, 12), bar(2, 14, 15), bar(3, 16, 4), bar(4, 6, 6)];
const testStrategy = strategy(closeRule("gt", 10), closeRule("lt", 5));

function run(costs?: {
  commission_per_trade?: number;
  commission_pct?: number;
  slippage_bps?: number;
}) {
  return runBacktest({
    positionMode: "long_only",
    strategy: testStrategy,
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    ...(costs
      ? {
          costs: {
            commission_per_trade: costs.commission_per_trade ?? 0,
            commission_pct: costs.commission_pct ?? 0,
            slippage_bps: costs.slippage_bps ?? 0,
          },
        }
      : {}),
  });
}

test("zero costs reproduce the frictionless result exactly", () => {
  const frictionless = run();
  const zeroCosts = run({});
  assert.deepEqual(zeroCosts.metrics, frictionless.metrics);
  assert.deepEqual(zeroCosts.trades, frictionless.trades);
  assert.equal(frictionless.metrics.total_commission, 0);
  assert.equal(frictionless.metrics.total_slippage_cost, 0);
});

test("slippage moves every fill against the account and is totalled", () => {
  const result = run({ slippage_bps: 100 });
  const [buy, sell] = result.trades;
  assert.ok(Math.abs(buy.price - 14 * 1.01) < 1e-9);
  assert.ok(Math.abs(sell.price - 6 * 0.99) < 1e-9);

  const shares = 10_000 / (14 * 1.01);
  const expectedSlippage = (14 * 1.01 - 14) * shares + (6 - 6 * 0.99) * shares;
  assert.ok(Math.abs(result.metrics.total_slippage_cost - expectedSlippage) < 1e-9);
  assert.ok(Math.abs(result.metrics.final_equity - shares * 6 * 0.99) < 1e-9);
  assert.ok(result.metrics.final_equity < run().metrics.final_equity);
});

test("commission is charged per fill and buys never overdraw cash", () => {
  const result = run({ commission_per_trade: 10, commission_pct: 1 });
  const [buy, sell] = result.trades;

  const spend = (10_000 - 10) / 1.01;
  assert.ok(Math.abs(buy.shares - spend / 14) < 1e-9);
  assert.ok(Math.abs(buy.commission - (10 + 0.01 * spend)) < 1e-9);
  assert.ok(Math.abs(buy.cash_after) < 1e-6);

  const proceeds = buy.shares * 6;
  assert.ok(Math.abs(sell.commission - (10 + 0.01 * proceeds)) < 1e-9);
  assert.ok(Math.abs(result.metrics.final_equity - (proceeds - sell.commission)) < 1e-9);
  assert.ok(
    Math.abs(result.metrics.total_commission - (buy.commission + sell.commission)) < 1e-9,
  );
});

test("always_in flips charge commission on the combined cover-and-flip value", () => {
  const result = runBacktest({
    positionMode: "always_in",
    strategy: testStrategy,
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    costs: { commission_per_trade: 5, commission_pct: 0.5, slippage_bps: 0 },
  });
  for (const trade of result.trades) {
    assert.ok(Math.abs(trade.commission - (5 + 0.005 * trade.value)) < 1e-9);
  }
  const summed = result.trades.reduce((sum, trade) => sum + trade.commission, 0);
  assert.ok(Math.abs(result.metrics.total_commission - summed) < 1e-9);
});

test("invalid cost settings are rejected", () => {
  assert.throws(
    () => run({ commission_pct: -1 }),
    /costs\.commission_pct must be a number between 0 and 10/,
  );
  assert.throws(
    () => run({ slippage_bps: 5_000 }),
    /costs\.slippage_bps must be a number between 0 and 1000/,
  );
});
