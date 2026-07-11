import assert from "node:assert/strict";
import test from "node:test";

import { computeMetrics } from "../src/services/backtestMetrics.ts";
import { runBacktest } from "../src/services/backtest.ts";
import type { BacktestEquityPoint, BacktestTrade } from "../src/types.ts";
import { bar, closeRule, strategy } from "./backtestFixtures.ts";

function equityPoint(index: number, equity: number): BacktestEquityPoint {
  return {
    timestamp_ms: bar(index, equity, equity).timestamp_ms,
    equity,
    cash: equity,
    shares: 0,
    position_value: 0,
  };
}

function sell(pnl: number): BacktestTrade {
  return {
    timestamp_ms: 0,
    side: "sell",
    price: 1,
    shares: 1,
    value: 1,
    cash_after: 0,
    shares_after: 0,
    equity_after: 0,
    commission: 0,
    realized_pnl: pnl,
  };
}

const epsilon = 1e-9;

test("max_drawdown_pct is the deepest peak-to-trough decline, non-positive", () => {
  const equityCurve = [100, 120, 90, 110].map((value, index) => equityPoint(index, value));
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 110,
    realizedPnl: 10,
    trades: [],
    equityCurve,
    candles: [bar(0, 100, 100), bar(3, 110, 110)],
  });

  assert.ok(Math.abs(metrics.max_drawdown_pct - -25) < epsilon);
});

test("profit_factor and avg_trade_pnl summarize closing trades", () => {
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 120,
    realizedPnl: 20,
    trades: [sell(30), sell(-10)],
    equityCurve: [equityPoint(0, 100), equityPoint(1, 120)],
    candles: [bar(0, 100, 100), bar(1, 120, 120)],
  });

  assert.ok(Math.abs((metrics.profit_factor ?? 0) - 3) < epsilon);
  assert.ok(Math.abs((metrics.avg_trade_pnl ?? 0) - 10) < epsilon);
});

test("profit_factor and avg_trade_pnl are null without closing trades", () => {
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades: [],
    equityCurve: [equityPoint(0, 100)],
    candles: [bar(0, 100, 100)],
  });

  assert.equal(metrics.profit_factor, null);
  assert.equal(metrics.avg_trade_pnl, null);
});

test("profit_factor is null when there are no losing trades", () => {
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 130,
    realizedPnl: 30,
    trades: [sell(30)],
    equityCurve: [equityPoint(0, 100), equityPoint(1, 130)],
    candles: [bar(0, 100, 100), bar(1, 130, 130)],
  });

  assert.equal(metrics.profit_factor, null);
});

test("annualized_return_pct is null under one candle and signed on a real span", () => {
  const single = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades: [],
    equityCurve: [equityPoint(0, 100)],
    candles: [bar(0, 100, 100)],
  });
  assert.equal(single.annualized_return_pct, null);

  const gain = computeMetrics({
    initialCapital: 100,
    finalEquity: 110,
    realizedPnl: 10,
    trades: [],
    equityCurve: [equityPoint(0, 100), equityPoint(1, 110)],
    candles: [bar(0, 100, 100), bar(1, 110, 110)],
  });
  assert.ok(Number.isFinite(gain.annualized_return_pct ?? NaN));
  assert.ok((gain.annualized_return_pct ?? 0) > 0);
});

test("sharpe_ratio is null without varying returns and finite otherwise", () => {
  const flat = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades: [],
    equityCurve: [100, 100, 100].map((value, index) => equityPoint(index, value)),
    candles: [bar(0, 1, 1), bar(1, 1, 1), bar(2, 1, 1)],
  });
  assert.equal(flat.sharpe_ratio, null);

  const varying = computeMetrics({
    initialCapital: 100,
    finalEquity: 108,
    realizedPnl: 8,
    trades: [],
    equityCurve: [100, 105, 102, 108].map((value, index) => equityPoint(index, value)),
    candles: [bar(0, 1, 1), bar(1, 1, 1), bar(2, 1, 1), bar(3, 1, 1)],
  });
  assert.ok(Number.isFinite(varying.sharpe_ratio ?? NaN));
});

test("runBacktest surfaces the new metrics on a real run", () => {
  const candles = [
    bar(0, 10, 8),
    bar(1, 9, 12),
    bar(2, 14, 15),
    bar(3, 16, 4),
    bar(4, 6, 6),
  ];
  const result = runBacktest({
    positionMode: "long_only",
    strategy: strategy(closeRule("gt", 10), closeRule("lt", 5)),
    candles,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
  });

  assert.ok(result.metrics.max_drawdown_pct <= 0);
  assert.equal(result.metrics.avg_trade_pnl, result.metrics.realized_pnl);
  assert.ok("annualized_return_pct" in result.metrics);
  assert.ok("sharpe_ratio" in result.metrics);
});

function positionPoint(index: number, equity: number, shares: number): BacktestEquityPoint {
  return { ...equityPoint(index, equity), shares, cash: 0, position_value: equity };
}

test("sortino_ratio penalizes only downside bars and calmar uses the drawdown", () => {
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 108,
    realizedPnl: 8,
    trades: [],
    equityCurve: [100, 105, 102, 108].map((value, index) => equityPoint(index, value)),
    candles: [bar(0, 1, 1), bar(1, 1, 1), bar(2, 1, 1), bar(3, 1, 1)],
  });
  assert.ok(Number.isFinite(metrics.sortino_ratio ?? NaN));
  assert.ok((metrics.sortino_ratio ?? 0) > (metrics.sharpe_ratio ?? 0));
  assert.ok(
    Math.abs(
      (metrics.calmar_ratio ?? 0) -
        (metrics.annualized_return_pct ?? 0) / Math.abs(metrics.max_drawdown_pct),
    ) < epsilon,
  );

  const onlyGains = computeMetrics({
    initialCapital: 100,
    finalEquity: 110,
    realizedPnl: 10,
    trades: [],
    equityCurve: [100, 105, 110].map((value, index) => equityPoint(index, value)),
    candles: [bar(0, 1, 1), bar(1, 1, 1), bar(2, 1, 1)],
  });
  assert.equal(onlyGains.sortino_ratio, null);
  assert.equal(onlyGains.calmar_ratio, null);
});

test("exposure and holding period count bars with an open position", () => {
  const equityCurve = [
    positionPoint(0, 100, 0),
    positionPoint(1, 100, 1),
    positionPoint(2, 100, 1),
    positionPoint(3, 100, 0),
    positionPoint(4, 100, -2),
    positionPoint(5, 100, 0),
  ];
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades: [],
    equityCurve,
    candles: equityCurve.map((_, index) => bar(index, 1, 1)),
  });
  assert.ok(Math.abs(metrics.exposure_pct - 50) < epsilon);
  assert.ok(Math.abs((metrics.avg_holding_period_candles ?? 0) - 1.5) < epsilon);

  const flat = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades: [],
    equityCurve: [equityPoint(0, 100)],
    candles: [bar(0, 1, 1)],
  });
  assert.equal(flat.exposure_pct, 0);
  assert.equal(flat.avg_holding_period_candles, null);
});

test("turnover_ratio divides traded value by mean equity", () => {
  const trades = [sell(0), sell(0)].map((trade) => ({ ...trade, value: 150 }));
  const metrics = computeMetrics({
    initialCapital: 100,
    finalEquity: 100,
    realizedPnl: 0,
    trades,
    equityCurve: [equityPoint(0, 100), equityPoint(1, 100)],
    candles: [bar(0, 1, 1), bar(1, 1, 1)],
  });
  assert.ok(Math.abs((metrics.turnover_ratio ?? 0) - 3) < epsilon);
});
