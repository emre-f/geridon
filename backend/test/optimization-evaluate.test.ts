import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFolds } from "../src/services/optimization/folds.ts";
import {
  evaluateBuyHold,
  evaluateFold,
  type EvaluationSettings,
} from "../src/services/optimization/evaluate.ts";
import { scoreTrial, resolveScoringConfig, compareTrialScores } from "../src/services/optimization/scoring.ts";
import { runBacktest } from "../src/services/backtest.ts";
import { candle, dataset, thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";
import type { FoldEvaluation, StrategyComplexity } from "../src/types.ts";

const settings: EvaluationSettings = {
  positionMode: "long_only",
  buyPercent: 100,
  sellPercent: 100,
  initialCapital: 10_000,
  objective: "total_return",
};

test("simulationStartIndex trades and measures only after the start index", () => {
  const candles = triangleCandles(100);
  const strategy = thresholdStrategy(95, 105);
  const windowed = runBacktest({
    strategy,
    candles,
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    simulationStartIndex: 60,
  });
  assert.equal(windowed.metrics.candle_count, 40);
  assert.equal(windowed.equity_curve.length, 40);
  assert.equal(windowed.equity_curve[0].timestamp_ms, candles[60].timestamp_ms);
  assert.ok(windowed.trades.every((trade) => trade.timestamp_ms >= candles[60].timestamp_ms));
});

test("candles after a fold's validation window cannot influence its result", () => {
  const data = dataset(400);
  const folds = buildFolds(data.candles.length, { foldCount: 4, mode: "anchored" });
  const strategy = thresholdStrategy(95, 105);
  const fold = folds[1];

  const before = evaluateFold(strategy, data, fold, settings);
  const mutated = {
    symbol: data.symbol,
    candles: data.candles.map((point, index) =>
      index > fold.validEndIndex ? candle(index, 1, 1) : point,
    ),
  };
  const after = evaluateFold(strategy, mutated, fold, settings);
  assert.deepEqual(after, before);
});

test("embargoed candles warm indicators but are never scored", () => {
  const data = dataset(400);
  const embargo = 15;
  const config = { foldCount: 4, mode: "anchored" } as const;
  const fold = buildFolds(data.candles.length, config)[1];
  const embargoedFold = buildFolds(data.candles.length, { ...config, embargoCandles: embargo })[1];
  const strategy = thresholdStrategy(95, 105);

  const plain = evaluateFold(strategy, data, fold, settings);
  const embargoed = evaluateFold(strategy, data, embargoedFold, settings);
  assert.equal(embargoed.candle_count, plain.candle_count - embargo);
  assert.deepEqual(evaluateFold(strategy, data, embargoedFold, settings), embargoed);
});

test("buy & hold evaluation is always long from the start of each window", () => {
  const data = dataset(400);
  const folds = new Map([["TEST", buildFolds(400, { foldCount: 4, mode: "anchored" })]]);
  const results = evaluateBuyHold([data], folds, settings);
  assert.equal(results.length, 4);
  for (const result of results) {
    assert.ok(result.trade_count >= 1);
  }
});

const complexity: StrategyComplexity = { activeRules: 2, uniqueIndicators: 0, maxDepth: 1 };

function fold(objective: number, drawdown = -5, trades = 4): FoldEvaluation {
  return {
    symbol: "TEST",
    foldIndex: 0,
    objectiveValue: objective,
    total_return_pct: objective,
    annualized_return_pct: objective,
    sharpe_ratio: null,
    max_drawdown_pct: drawdown,
    trade_count: trades,
    candle_count: 100,
  };
}

test("score is the median objective minus penalties", () => {
  const config = resolveScoringConfig({
    objective: "total_return",
    penalties: { drawdown: 0.1, instability: 0.5, turnover: 0.1, complexity: 0.5 },
  });
  const score = scoreTrial([fold(10), fold(12), fold(8)], complexity, config);
  assert.equal(score.medianObjective, 10);
  assert.ok(score.score < 10);
  assert.ok(score.penalties.drawdown > 0);
  assert.ok(score.penalties.instability > 0);
  assert.ok(score.penalties.complexity > 0);
});

test("eligibility constraints produce explicit reasons", () => {
  const config = resolveScoringConfig({
    objective: "total_return",
    constraints: { minTotalTrades: 20, maxDrawdownPct: 3, minPositiveFoldFraction: 1 },
  });
  const score = scoreTrial([fold(10), fold(-1, -8, 2)], complexity, config);
  assert.equal(score.eligible, false);
  assert.equal(score.ineligibilityReasons.length, 3);
});

test("eligible trials rank above ineligible ones regardless of raw score", () => {
  const config = resolveScoringConfig({ objective: "total_return" });
  const eligible = scoreTrial([fold(2), fold(3), fold(4)], complexity, config);
  const ineligible = scoreTrial([fold(50, -80, 1)], complexity, config);
  assert.equal(eligible.eligible, true);
  assert.equal(ineligible.eligible, false);
  assert.ok(compareTrialScores(eligible, ineligible) < 0);
});
