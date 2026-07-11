import assert from "node:assert/strict";
import test from "node:test";

import type {
  OptimizationExperimentSummary,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";
import type { FoldEvaluation, SearchSpaceNode, TrialScore } from "@/lib/api-optimization-types";
import {
  bestScoredTrial,
  decompositionRows,
  foldGroups,
  formatDuration,
  formatSampledValue,
  nodeLabel,
} from "./optimize-chart-utils.ts";

function score(value: number, eligible = true, medianObjective = value): TrialScore {
  return {
    score: value,
    medianObjective,
    eligible,
    ineligibilityReasons: eligible ? [] : ["too few trades"],
    penalties: { drawdown: 0.1, instability: 0.05, turnover: 0, complexity: 0.02 },
  };
}

function trial(overrides: Partial<OptimizationTrialRecord>): OptimizationTrialRecord {
  return {
    experiment_id: 1,
    trial_index: 0,
    hash: "hash",
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

function fold(overrides: Partial<FoldEvaluation>): FoldEvaluation {
  return {
    symbol: "AAPL",
    foldIndex: 0,
    objectiveValue: 1,
    total_return_pct: 5,
    annualized_return_pct: null,
    sharpe_ratio: 1,
    max_drawdown_pct: -10,
    trade_count: 4,
    candle_count: 100,
    ...overrides,
  };
}

function summary(overrides?: Partial<OptimizationExperimentSummary>): OptimizationExperimentSummary {
  return {
    scoring_version: "1",
    stopped_early: false,
    elapsed_ms: 1000,
    baseline: {
      foldResults: [fold({})],
      score: score(0.5, true, 0.67),
      complexity: { activeRules: 2, uniqueIndicators: 1, maxDepth: 1 },
    },
    buy_hold: { foldResults: [fold({ objectiveValue: 0.4 })], medianObjective: 0.4 },
    space: [],
    ablation: [],
    pareto_fronts: [],
    trial_counts: { total: 10, scored: 6, pruned: 3, rejected: 1 },
    best_trial_index: null,
    ...overrides,
  };
}

test("decompositionRows puts the baseline first, then top eligible trials by rank", () => {
  const trials = [
    trial({ trial_index: 3, rank: 2, score: score(0.6) }),
    trial({ trial_index: 7, rank: 1, score: score(0.9) }),
    trial({ trial_index: 4, rank: null, status: "pruned", score: score(2.0) }),
    trial({ trial_index: 5, rank: 3, score: score(0.2, false) }),
  ];

  const rows = decompositionRows(summary(), trials);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["baseline", "trial-7", "trial-3"],
  );
  assert.equal(rows[0].medianObjective, 0.67);
  assert.equal(rows[1].label, "#1 · t7");
  assert.equal(rows[1].score, 0.9);
});

test("decompositionRows caps the number of trial rows", () => {
  const trials = Array.from({ length: 12 }, (_, index) =>
    trial({ trial_index: index, rank: index + 1, score: score(1 - index / 12) }),
  );

  const rows = decompositionRows(summary(), trials, 8);
  assert.equal(rows.length, 9);
});

test("foldGroups aligns series by symbol and fold with nulls for missing folds", () => {
  const baseline = [fold({ foldIndex: 0, objectiveValue: 1 }), fold({ foldIndex: 1, objectiveValue: 2 })];
  const buyHold = [fold({ foldIndex: 0, objectiveValue: 0.5 }), fold({ foldIndex: 1, objectiveValue: 0.6 })];
  const candidate = [fold({ foldIndex: 0, objectiveValue: 3 })];

  const groups = foldGroups(baseline, buyHold, candidate);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    key: "AAPL#0",
    label: "Fold 1",
    symbol: "AAPL",
    foldIndex: 0,
    baseline: 1,
    buyHold: 0.5,
    candidate: 3,
  });
  assert.equal(groups[1].candidate, null);
});

test("foldGroups labels folds with the symbol when several symbols exist", () => {
  const groups = foldGroups(
    [fold({ symbol: "MSFT", foldIndex: 0 }), fold({ symbol: "AAPL", foldIndex: 0 })],
    [],
    null,
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ["AAPL F1", "MSFT F1"],
  );
});

test("nodeLabel compresses dotted strategy paths into short labels", () => {
  const numeric: SearchSpaceNode = {
    id: "entry.conditions.0.left.params.fast",
    kind: "numeric",
    path: ["entry", "conditions", "0", "left", "params", "fast"],
    valueType: "integer",
    min: 2,
    max: 30,
    step: 1,
    scale: "linear",
    current: 12,
  };
  const threshold: SearchSpaceNode = {
    id: "exit.conditions.1.right.value",
    kind: "numeric",
    path: ["exit", "conditions", "1", "right", "value"],
    valueType: "decimal",
    min: 20,
    max: 40,
    step: 1,
    scale: "linear",
    current: 30,
  };
  const toggle: SearchSpaceNode = {
    id: "entry.conditions.2.enabled",
    kind: "toggle",
    path: ["entry", "conditions", "2", "enabled"],
    current: true,
  };

  assert.equal(nodeLabel(numeric), "entry r1 fast");
  assert.equal(nodeLabel(threshold), "exit r2 threshold");
  assert.equal(nodeLabel(toggle), "entry r3 enabled");
});

test("formatSampledValue renders booleans, integers, and trimmed decimals", () => {
  assert.equal(formatSampledValue(true), "on");
  assert.equal(formatSampledValue(false), "off");
  assert.equal(formatSampledValue(14), "14");
  assert.equal(formatSampledValue(0.25), "0.25");
  assert.equal(formatSampledValue(1.23456), "1.235");
});

test("formatDuration switches units with magnitude", () => {
  assert.equal(formatDuration(4_000), "4s");
  assert.equal(formatDuration(84_000), "1m 24s");
  assert.equal(formatDuration(3_720_000), "1h 2m");
});

test("bestScoredTrial prefers the summary's best index and falls back to max score", () => {
  const trials = [
    trial({ trial_index: 0, score: score(0.1) }),
    trial({ trial_index: 1, score: score(0.9) }),
    trial({ trial_index: 2, status: "pruned", score: score(2.0) }),
  ];

  assert.equal(bestScoredTrial(trials, 0)?.trial_index, 0);
  assert.equal(bestScoredTrial(trials, null)?.trial_index, 1);
  assert.equal(bestScoredTrial([], null), null);
});
