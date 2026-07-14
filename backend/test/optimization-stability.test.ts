import assert from "node:assert/strict";
import { test } from "node:test";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { computeParameterStability } from "../src/services/optimization/stability.ts";
import type { OptimizationTrial, SearchSpaceNode, TrialScore } from "../src/types.ts";
import { baseConfig, thresholdStrategy } from "./optimizationFixtures.ts";

function score(value: number): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible: true,
    ineligibilityReasons: [],
    penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
  };
}

function scoredTrial(index: number, values: Record<string, number>, scoreValue: number): OptimizationTrial {
  return {
    index,
    hash: String(index),
    values,
    strategy: thresholdStrategy(95, 105),
    status: "scored",
    stageReached: 2,
    foldResults: [],
    score: score(scoreValue),
    complexity: { activeRules: 2, uniqueIndicators: 0, maxDepth: 1 },
    phase: "search",
  };
}

const numericNode: SearchSpaceNode = {
  id: "entry.right.value",
  kind: "numeric",
  path: ["entry", "right", "value"],
  valueType: "decimal",
  min: 80,
  max: 120,
  step: 0.5,
  scale: "linear",
  current: 95,
};

const toggleNode: SearchSpaceNode = {
  id: "entry.enabled",
  kind: "toggle",
  path: ["entry", "enabled"],
  current: true,
};

test("stability aggregates the scores of trials sampled near the best value", () => {
  const best = scoredTrial(0, { "entry.right.value": 95 }, 1.0);
  const trials = [
    best,
    scoredTrial(1, { "entry.right.value": 96 }, 0.9),
    scoredTrial(2, { "entry.right.value": 92 }, 0.5),
    scoredTrial(3, { "entry.right.value": 110 }, -0.4),
  ];
  const entries = computeParameterStability([numericNode, toggleNode], trials, best);

  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.nodeId, "entry.right.value");
  assert.equal(entry.bestValue, 95);
  assert.equal(entry.bestScore, 1.0);
  assert.equal(entry.neighborCount, 2);
  assert.equal(entry.neighborScoreMedian, 0.7);
  assert.equal(entry.neighborScoreMin, 0.5);
});

test("stability reports an empty neighborhood as null rather than zero", () => {
  const best = scoredTrial(0, { "entry.right.value": 95 }, 1.0);
  const far = scoredTrial(1, { "entry.right.value": 115 }, 0.2);
  const entries = computeParameterStability([numericNode], [best, far], best);

  assert.equal(entries[0].neighborCount, 0);
  assert.equal(entries[0].neighborScoreMedian, null);
  assert.equal(entries[0].neighborScoreMin, null);
});

test("stability skips dimensions the best trial never sampled and handles no best trial", () => {
  const best = scoredTrial(0, {}, 1.0);
  assert.deepEqual(computeParameterStability([numericNode], [best], best), []);
  assert.deepEqual(computeParameterStability([numericNode], [], undefined), []);
});

test("optimization results carry stability entries for searched numeric dimensions", () => {
  const result = runOptimization(
    baseConfig(thresholdStrategy(95, 105), {
      maxTrials: 30,
      parameterOverrides: {
        "entry.right.value": { min: 88, max: 99 },
        "exit.right.value": { min: 102, max: 112 },
      },
    }),
  );
  assert.ok(result.leaderboard.length > 0);
  const nodeIds = result.stability.map((entry) => entry.nodeId).sort();
  assert.deepEqual(nodeIds, ["entry.right.value", "exit.right.value"]);
  for (const entry of result.stability) {
    assert.equal(entry.bestScore, result.leaderboard[0].score!.score);
    assert.equal(typeof entry.bestValue, "number");
  }
});
