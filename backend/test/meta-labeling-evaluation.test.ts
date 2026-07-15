import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateOverlay } from "../src/services/metaLabeling/evaluation.ts";
import {
  classify,
  foldEvaluationFromTrades,
  precision,
  recall,
  type AppliedTrade,
} from "../src/services/metaLabeling/overlayMetrics.ts";
import { regimeDataset, thresholdStrategy } from "./optimizationFixtures.ts";

const base = {
  symbol: "TEST" as const,
  positionMode: "long_only" as const,
  buyPercent: 100,
  sellPercent: 100,
  initialCapital: 10_000,
  folds: { foldCount: 4, mode: "anchored" as const },
};

function overlayInput() {
  return {
    ...base,
    strategy: thresholdStrategy(100, 101.9),
    candles: regimeDataset().candles,
    costs: { commission_per_trade: 0, commission_pct: 2, slippage_bps: 0 },
  };
}

test("classify counts and precision/recall match hand-built outcomes", () => {
  const trades: AppliedTrade[] = [
    { size: 1, return_pct: 5, label: 1 },
    { size: 1, return_pct: -5, label: 0 },
    { size: 0, return_pct: 8, label: 1 },
    { size: 0, return_pct: -3, label: 0 },
  ];
  const counts = classify(trades);
  assert.deepEqual(counts, {
    taken_winners: 1,
    taken_losers: 1,
    skipped_winners: 1,
    skipped_losers: 1,
  });
  assert.equal(precision(counts), 0.5, "half of taken trades were winners");
  assert.equal(recall(counts), 0.5, "half of the winners were taken");
  assert.equal(precision({ taken_winners: 0, taken_losers: 0, skipped_winners: 2, skipped_losers: 1 }), null);
  assert.equal(recall({ taken_winners: 0, taken_losers: 1, skipped_winners: 0, skipped_losers: 1 }), null);
});

test("shrinking a trade scales its compounded return and drawdown", () => {
  const trades: AppliedTrade[] = [
    { size: 1, return_pct: 10, label: 1 },
    { size: 1, return_pct: -10, label: 0 },
  ];
  const evaluation = foldEvaluationFromTrades("TEST", 0, trades, 50, "total_return");
  assert.equal(evaluation.trade_count, 2);
  assert.ok(Math.abs(evaluation.total_return_pct - -1) < 1e-9, "1.1 * 0.9 - 1 = -1%");
  assert.ok(Math.abs(evaluation.max_drawdown_pct - 10) < 1e-9, "peak 1.1 down to 0.99");
  assert.equal(evaluation.candle_count, 50);

  const skipped = foldEvaluationFromTrades(
    "TEST",
    0,
    [{ size: 0, return_pct: -10, label: 0 }],
    50,
    "total_return",
  );
  assert.equal(skipped.trade_count, 0);
  assert.equal(skipped.total_return_pct, 0, "a fully-skipped fold neither gains nor loses");
});

test("take-everything keeps every trade and the random-skip control matches the overlay's skip counts", () => {
  const result = evaluateOverlay(overlayInput(), { seed: 42 });

  assert.equal(result.take_everything.trades_skipped, 0);
  assert.equal(result.take_everything.skip_rate, 0);
  assert.ok(result.take_everything.trades_total > 0, "the baseline strategy produced trades to evaluate");

  assert.equal(
    result.random_skip.trades_kept,
    result.filtered.trades_kept,
    "the control drops exactly as many trades as the overlay",
  );
  for (const foldStat of result.filtered.fold_stats) {
    const control = result.random_skip.fold_stats.find((f) => f.fold_index === foldStat.fold_index);
    assert.ok(control, "every fold has a control entry");
    assert.equal(
      control!.trades_skipped,
      foldStat.trades_skipped,
      "same per-fold skip count controls for exposure",
    );
  }

  for (const policy of [result.filtered, result.take_everything, result.random_skip]) {
    assert.ok(Number.isFinite(policy.score.score), "every policy gets a finite robust score");
    assert.ok(policy.precision === null || (policy.precision >= 0 && policy.precision <= 1));
    assert.ok(policy.recall === null || (policy.recall >= 0 && policy.recall <= 1));
  }
});

test("overlay evaluation is reproducible for a fixed seed", () => {
  const input = overlayInput();
  assert.deepEqual(evaluateOverlay(input, { seed: 7 }), evaluateOverlay(input, { seed: 7 }));
});
