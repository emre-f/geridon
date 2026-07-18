import assert from "node:assert/strict";
import test from "node:test";

import type { TradeCosts } from "../src/types/backtests.ts";
import { computeCostLine, roundTripCost } from "../src/services/signalEval/costLine.ts";
import type { HorizonSummary } from "../src/services/signalEval/horizonSummary.ts";

const zeroCosts: TradeCosts = { commission_per_trade: 0, commission_pct: 0, slippage_bps: 0 };

function makeSummary(
  abnormals: Array<number | null>,
  naturalHoldingPeriod: number | null,
  peakGap: number | null,
): HorizonSummary {
  const horizons = [1, 5, 10, 21, 63];
  return {
    rows: horizons.map((horizon, index) => ({
      horizon,
      signal_mean: abnormals[index],
      baseline_mean: abnormals[index] == null ? null : 0,
      abnormal: abnormals[index],
    })),
    natural_holding_period_bars: naturalHoldingPeriod,
    peak_gap: peakGap,
  };
}

test("round trip charges every cost component on both sides", () => {
  const costs: TradeCosts = { commission_per_trade: 5, commission_pct: 0.1, slippage_bps: 10 };
  assert.equal(roundTripCost(costs, 10_000), 2 * (0.0005 + 0.001 + 0.001));
});

test("zero costs mean a zero cost line and net equals gross", () => {
  const line = computeCostLine(makeSummary([0.001, 0.005, 0.01, 0.021, 0.021], 21, 0.021), {
    costs: zeroCosts,
  });

  assert.equal(line.round_trip_cost, 0);
  assert.equal(line.headline_horizon, 21);
  assert.equal(line.gross_abnormal_return, 0.021);
  assert.equal(line.net_abnormal_return, 0.021);
  assert.ok(line.rows.every((row) => row.net_abnormal === row.abnormal));
});

test("headline is the natural holding period gap minus the round trip", () => {
  const costs: TradeCosts = { commission_per_trade: 0, commission_pct: 0, slippage_bps: 10 };
  const line = computeCostLine(makeSummary([0.001, 0.005, 0.01, 0.021, 0.021], 21, 0.021), {
    costs,
  });

  assert.equal(line.round_trip_cost, 0.002);
  assert.equal(line.headline_horizon, 21);
  assert.equal(line.gross_abnormal_return, 0.021);
  assert.ok(Math.abs((line.net_abnormal_return as number) - 0.019) < 1e-12);
  assert.deepEqual(
    line.rows.map((row) => [row.horizon, row.net_abnormal]),
    [
      [1, 0.001 - 0.002],
      [5, 0.005 - 0.002],
      [10, 0.01 - 0.002],
      [21, 0.021 - 0.002],
      [63, 0.021 - 0.002],
    ],
  );
});

test("an edge smaller than costs goes net-negative", () => {
  const costs: TradeCosts = { commission_per_trade: 0, commission_pct: 0, slippage_bps: 12.5 };
  const line = computeCostLine(makeSummary([0.0005, 0.001, 0.002, 0.002, 0.002], 10, 0.002), {
    costs,
  });

  assert.equal(line.round_trip_cost, 0.0025);
  assert.ok((line.net_abnormal_return as number) < 0);
});

test("without a holding period the headline falls back to the longest horizon with data", () => {
  const line = computeCostLine(makeSummary([-0.001, -0.002, -0.003, null, null], null, -0.001), {
    costs: zeroCosts,
  });

  assert.equal(line.headline_horizon, 10);
  assert.equal(line.gross_abnormal_return, -0.003);
  assert.equal(line.net_abnormal_return, -0.003);
});

test("an all-null summary yields a null headline, not a fake zero", () => {
  const line = computeCostLine(makeSummary([null, null, null, null, null], null, null), {
    costs: zeroCosts,
  });

  assert.equal(line.headline_horizon, null);
  assert.equal(line.gross_abnormal_return, null);
  assert.equal(line.net_abnormal_return, null);
  assert.ok(line.rows.every((row) => row.net_abnormal == null));
});

test("fixed commission needs a positive notional and invalid costs are rejected", () => {
  assert.throws(
    () => roundTripCost({ ...zeroCosts, commission_per_trade: 5 }, 0),
    /notionalPerEvent/,
  );
  assert.throws(() => roundTripCost({ ...zeroCosts, slippage_bps: -1 }), /slippage_bps/);
});
