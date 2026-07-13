import assert from "node:assert/strict";
import test from "node:test";

import type {
  OptimizationExperimentSummary,
  OptimizationTrialMetrics,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";
import type { FoldEvaluation, TrialScore } from "@/lib/api-optimization-types";
import { paretoChartData } from "./optimize-pareto-utils.ts";

function score(value: number, eligible = true): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible,
    ineligibilityReasons: eligible ? [] : ["too few trades"],
    penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
  };
}

function metrics(drawdownPct: number): OptimizationTrialMetrics {
  return {
    median_return_pct: 5,
    worst_fold_return_pct: 1,
    median_drawdown_pct: drawdownPct,
    worst_drawdown_pct: drawdownPct + 5,
    total_trades: 12,
    median_turnover_ratio: null,
    fold_count: 4,
  };
}

function trial(
  trialIndex: number,
  overrides: Partial<OptimizationTrialRecord>,
): OptimizationTrialRecord {
  return {
    experiment_id: 1,
    trial_index: trialIndex,
    hash: `hash-${trialIndex}`,
    phase: "search",
    status: "scored",
    rejection_reason: null,
    stage_reached: 1,
    rank: null,
    eligible: null,
    score: null,
    values: {},
    complexity: { activeRules: 1, uniqueIndicators: 1, maxDepth: 1 },
    metrics: null,
    ...overrides,
  };
}

function fold(maxDrawdownPct: number): FoldEvaluation {
  return {
    symbol: "AAPL",
    foldIndex: 0,
    objectiveValue: 1,
    total_return_pct: 5,
    annualized_return_pct: null,
    sharpe_ratio: 1,
    max_drawdown_pct: maxDrawdownPct,
    trade_count: 4,
    candle_count: 100,
  };
}

function summary(paretoFronts: number[][]): OptimizationExperimentSummary {
  return {
    scoring_version: "2",
    stopped_early: false,
    elapsed_ms: 1000,
    baseline: {
      foldResults: [fold(-10), fold(-20), fold(-14)],
      score: score(0.5),
      complexity: { activeRules: 2, uniqueIndicators: 1, maxDepth: 1 },
    },
    buy_hold: { foldResults: [], medianObjective: 0.4 },
    space: [],
    ablation: [],
    pareto_fronts: paretoFronts,
    trial_counts: { total: 4, scored: 3, pruned: 1, rejected: 0 },
    best_trial_index: 2,
  };
}

test("paretoChartData marks front trials, sorts the frontier, and derives the baseline", () => {
  const trials = [
    trial(1, { rank: 2, score: score(0.8), metrics: metrics(18) }),
    trial(2, { rank: 1, score: score(1.1), metrics: metrics(25) }),
    trial(3, { rank: 3, score: score(0.4, false), metrics: metrics(9) }),
    trial(4, { status: "pruned", score: score(2.5), metrics: metrics(1) }),
    trial(5, { score: score(0.7), metrics: null }),
  ];

  const data = paretoChartData(summary([[2, 3], [1]]), trials);
  assert.ok(data);
  assert.deepEqual(
    data.points.map((point) => point.trialIndex),
    [1, 2, 3],
  );
  assert.deepEqual(
    data.points.map((point) => point.onFront),
    [false, true, true],
  );
  assert.deepEqual(
    data.front.map((point) => point.trialIndex),
    [3, 2],
  );
  assert.equal(data.baseline.objective, 0.5);
  assert.equal(data.baseline.drawdownPct, 14);
});

test("paretoChartData returns null with fewer than two scored trials", () => {
  const trials = [trial(1, { score: score(0.8), metrics: metrics(18) })];
  assert.equal(paretoChartData(summary([[1]]), trials), null);
});

test("paretoChartData survives experiments without stored fronts", () => {
  const trials = [
    trial(1, { score: score(0.8), metrics: metrics(18) }),
    trial(2, { score: score(1.1), metrics: metrics(25) }),
  ];
  const data = paretoChartData(summary([]), trials);
  assert.ok(data);
  assert.deepEqual(data.front, []);
  assert.ok(data.points.every((point) => !point.onFront));
});
