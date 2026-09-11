import assert from "node:assert/strict";
import test from "node:test";

import type {
  OptimizationExperimentRecord,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";
import type { FoldEvaluation, TradeCosts, TrialScore } from "@/lib/api-optimization-types";
import { experimentWarnings } from "./optimize-warning-utils.ts";

const realisticCosts: TradeCosts = { commission_per_trade: 1, commission_pct: 0.05, slippage_bps: 5 };
const zeroCosts: TradeCosts = { commission_per_trade: 0, commission_pct: 0, slippage_bps: 0 };

function fold(candleCount: number): FoldEvaluation {
  return {
    symbol: "TEST",
    foldIndex: 0,
    objectiveValue: 1,
    total_return_pct: 5,
    annualized_return_pct: null,
    sharpe_ratio: 1,
    max_drawdown_pct: -5,
    trade_count: 4,
    candle_count: candleCount,
  };
}

function record(costs: TradeCosts, foldCandles: number[]): OptimizationExperimentRecord {
  return {
    id: 1,
    status: "completed",
    config: {
      strategy_id: 1,
      tickers: ["TEST"],
      timeframe: "1d",
      start_ms: 0,
      end_ms: 1,
      position_mode: "long_only",
      buy_percent: 100,
      sell_percent: 100,
      initial_capital: 10_000,
      costs,
      seed: 1,
      max_trials: 10,
      max_runtime_ms: 60_000,
      worker_count: 1,
      method: "random",
      folds: { foldCount: foldCandles.length, mode: "anchored" },
    },
    snapshot: { strategy_name: "Test" } as OptimizationExperimentRecord["snapshot"],
    progress: null,
    summary: {
      scoring_version: "1",
      stopped_early: false,
      elapsed_ms: 0,
      baseline: {
        foldResults: foldCandles.map(fold),
        score: score(1),
        complexity: { activeRules: 1, uniqueIndicators: 1, maxDepth: 1 },
      },
      buy_hold: { foldResults: [], medianObjective: 0 },
      space: [],
      ablation: [],
      pareto_fronts: [],
      trial_counts: { total: 10, scored: 8, pruned: 1, rejected: 1 },
      best_trial_index: 0,
    },
    holdout: null,
    error: null,
    created_at: "",
    updated_at: "",
  };
}

function score(value: number, instability = 0): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible: true,
    ineligibilityReasons: [],
    penalties: { drawdown: 0, instability, turnover: 0, complexity: 0 },
  };
}

function bestTrial(
  overrides: Partial<OptimizationTrialRecord["metrics"] & { scoreDetail: TrialScore }> = {},
): OptimizationTrialRecord {
  const { scoreDetail, ...metrics } = overrides;
  return {
    experiment_id: 1,
    trial_index: 0,
    hash: "hash",
    phase: "search",
    status: "scored",
    rejection_reason: null,
    stage_reached: 2,
    rank: 1,
    eligible: true,
    score: scoreDetail ?? score(1),
    values: {},
    complexity: { activeRules: 1, uniqueIndicators: 1, maxDepth: 1 },
    metrics: {
      median_return_pct: 5,
      worst_fold_return_pct: 1,
      median_drawdown_pct: 5,
      worst_drawdown_pct: 8,
      total_trades: 20,
      median_turnover_ratio: null,
      fold_count: 4,
      ...metrics,
    },
    ...({} as Partial<OptimizationTrialRecord>),
  };
}

test("a healthy experiment with realistic costs produces no warnings", () => {
  assert.deepEqual(experimentWarnings(record(realisticCosts, [200, 200]), bestTrial()), []);
});

test("zero transaction costs are flagged", () => {
  const warnings = experimentWarnings(record(zeroCosts, [200, 200]), bestTrial());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /costs are zero/i);
});

test("a short validation fold is flagged as a small sample", () => {
  const warnings = experimentWarnings(record(realisticCosts, [200, 30]), bestTrial());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /only 30 candles/);
});

test("too few trades on the top candidate are flagged", () => {
  const warnings = experimentWarnings(
    record(realisticCosts, [200, 200]),
    bestTrial({ total_trades: 3 }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /traded only 3 times/);
});

test("instability is flagged when the penalty dominates the objective", () => {
  const warnings = experimentWarnings(
    record(realisticCosts, [200, 200]),
    bestTrial({ scoreDetail: score(1, 0.8) }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unstable/i);
});

test("instability is flagged when the worst fold loses despite a positive median", () => {
  const warnings = experimentWarnings(
    record(realisticCosts, [200, 200]),
    bestTrial({ worst_fold_return_pct: -4 }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unstable/i);
});

test("a missing best trial only yields config-level warnings", () => {
  const warnings = experimentWarnings(record(zeroCosts, [200, 200]), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /costs are zero/i);
});

test("an opened sealed holdout is flagged first", () => {
  const opened = record(realisticCosts, [200, 200]);
  opened.holdout = {
    trial_index: 3,
    opened_at: "2026-07-11T00:00:00.000Z",
    candidate: [],
    baseline: [],
    buy_hold: [],
  };
  const warnings = experimentWarnings(opened, bestTrial());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /holdout was opened for trial 3/);
});
