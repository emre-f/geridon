import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFolds } from "../src/services/optimization/folds.ts";
import { evaluateOnFolds, type EvaluationSettings } from "../src/services/optimization/evaluate.ts";
import {
  compareTrialScores,
  resolveScoringConfig,
  scoreTrial,
  scoringVersion,
} from "../src/services/optimization/scoring.ts";
import { computeComplexity } from "../src/services/optimization/strategyPaths.ts";
import { regimeDataset, thresholdStrategy } from "./optimizationFixtures.ts";
import type { FoldEvaluation, Strategy, StrategyComplexity, TrialScore } from "../src/types.ts";

const settings: EvaluationSettings = {
  positionMode: "long_only",
  buyPercent: 100,
  sellPercent: 100,
  initialCapital: 10_000,
  objective: "sharpe",
};

const config = resolveScoringConfig();

function scoreOnRegimes(strategy: Strategy): TrialScore {
  const data = regimeDataset();
  const folds = new Map([
    [data.symbol, buildFolds(data.candles.length, { foldCount: 4, mode: "anchored" })],
  ]);
  const foldResults = evaluateOnFolds(strategy, [data], folds, settings);
  return scoreTrial(foldResults, computeComplexity(strategy), config);
}

const good = thresholdStrategy(98, 101.9);
const bad: Strategy = {
  name: "Buy high sell low",
  entry: { type: "rule", left: { type: "price", field: "close" }, operator: "gt", right: { type: "value", value: 104 } },
  exit: { type: "rule", left: { type: "price", field: "close" }, operator: "lt", right: { type: "value", value: 96 } },
};
const lucky = thresholdStrategy(91, 109);

test("a strategy profitable in every regime scores positive and eligible", () => {
  const score = scoreOnRegimes(good);
  assert.equal(score.eligible, true, score.ineligibilityReasons.join("; "));
  assert.ok(score.score > 0, `expected positive score, got ${score.score.toFixed(3)}`);
  assert.ok(score.medianObjective > 0);
});

test("a buy-high-sell-low strategy is ineligible or scores below zero", () => {
  const score = scoreOnRegimes(bad);
  assert.ok(!score.eligible || score.score < 0);
  assert.ok(compareTrialScores(scoreOnRegimes(good), score) < 0);
});

test("a strategy that only works in one regime ranks below an all-regime one", () => {
  const score = scoreOnRegimes(lucky);
  assert.equal(score.eligible, false);
  assert.ok(compareTrialScores(scoreOnRegimes(good), score) < 0);
});

const complexity: StrategyComplexity = { activeRules: 3, uniqueIndicators: 2, maxDepth: 1 };

function fold(sharpe: number, drawdownPct: number, trades: number): FoldEvaluation {
  return {
    symbol: "TEST",
    foldIndex: 0,
    objectiveValue: sharpe,
    total_return_pct: sharpe * 10,
    annualized_return_pct: sharpe * 10,
    sharpe_ratio: sharpe,
    max_drawdown_pct: -drawdownPct,
    trade_count: trades,
    candle_count: 250,
  };
}

const steadyGood = [fold(1.6, 12, 8), fold(1.2, 10, 9), fold(1.5, 14, 7), fold(1.3, 12, 8)];
const dispersedGood = [fold(2.4, 18, 9), fold(0.4, 22, 7), fold(1.8, 15, 8), fold(0.6, 20, 8)];
const deepDrawdownGood = [fold(1.7, 28, 8), fold(1.4, 32, 9), fold(1.5, 30, 8), fold(1.6, 29, 7)];
const luckyFold = [fold(3.5, 10, 10), fold(0, 5, 0), fold(-0.2, 8, 2), fold(0.1, 6, 1)];

test("regime-dispersed but always-positive fold sharpes keep a positive score", () => {
  const score = scoreTrial(dispersedGood, complexity, config);
  assert.equal(score.eligible, true);
  assert.ok(score.score > 0, `expected positive score, got ${score.score.toFixed(3)}`);
});

test("a 30% drawdown does not flip a decent strategy negative", () => {
  const score = scoreTrial(deepDrawdownGood, complexity, config);
  assert.ok(score.score > 0);
});

test("stability still orders otherwise comparable candidates", () => {
  const steady = scoreTrial(steadyGood, complexity, config);
  const dispersed = scoreTrial(dispersedGood, complexity, config);
  const oneLuckyFold = scoreTrial(luckyFold, complexity, config);
  assert.ok(steady.score > dispersed.score);
  assert.ok(compareTrialScores(dispersed, oneLuckyFold) < 0);
  assert.equal(scoringVersion, "2");
});
