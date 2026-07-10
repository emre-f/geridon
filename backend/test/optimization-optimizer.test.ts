import assert from "node:assert/strict";
import { test } from "node:test";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { OptimizationResult, Strategy } from "../src/types.ts";

function curatedThresholdConfig(seed = 42) {
  return baseConfig(thresholdStrategy(95, 105), {
    seed,
    parameterOverrides: {
      "entry.right.value": { choices: [90.5, 93, 95] },
      "exit.right.value": { choices: [105, 107, 109.5] },
    },
  });
}

function leaderboardFingerprint(result: OptimizationResult) {
  return result.leaderboard.map((trial) => `${trial.hash}:${trial.score?.score}`);
}

test("identical config and seed reproduce the same trials and ranking", () => {
  const first = runOptimization(curatedThresholdConfig());
  const second = runOptimization(curatedThresholdConfig());
  assert.deepEqual(
    second.trials.map((trial) => trial.hash),
    first.trials.map((trial) => trial.hash),
  );
  assert.deepEqual(leaderboardFingerprint(second), leaderboardFingerprint(first));
});

test("different seeds explore a different candidate sequence", () => {
  const first = runOptimization(curatedThresholdConfig(1));
  const second = runOptimization(curatedThresholdConfig(2));
  assert.notDeepEqual(
    second.trials.map((trial) => trial.hash),
    first.trials.map((trial) => trial.hash),
  );
});

test("random search finds the best curated thresholds and beats the baseline", () => {
  const result = runOptimization(curatedThresholdConfig());
  const best = result.leaderboard[0];
  assert.ok(best?.score);
  assert.ok(best.score.eligible);
  assert.ok(best.score.score > result.baseline.score.score);
  assert.equal(best.values["entry.right.value"], 90.5);
  assert.equal(best.values["exit.right.value"], 109.5);
});

test("duplicate candidates are rejected with a recorded reason", () => {
  const result = runOptimization(curatedThresholdConfig());
  const duplicates = result.trials.filter(
    (trial) => trial.status === "rejected" && /duplicate/.test(trial.rejectionReason ?? ""),
  );
  assert.ok(duplicates.length > 0);
});

test("successive halving prunes weak candidates before the final stage", () => {
  const config = baseConfig(thresholdStrategy(95, 105), { refinement: { enabled: false } });
  const result = runOptimization(config);
  const pruned = result.trials.filter((trial) => trial.status === "pruned");
  const scored = result.trials.filter((trial) => trial.status === "scored");
  assert.ok(pruned.length > 0);
  assert.ok(scored.length > 0);
  assert.ok(pruned.some((trial) => trial.stageReached < 2));
});

test("refinement trials search a narrowed space around top candidates", () => {
  const result = runOptimization(baseConfig(thresholdStrategy(95, 105)));
  const refineTrials = result.trials.filter((trial) => trial.phase === "refine");
  assert.ok(refineTrials.length > 0);
  assert.ok(refineTrials.some((trial) => trial.status === "scored"));
});

test("optional rule toggles let the optimizer disable a harmful rule", () => {
  const strategy: Strategy = {
    name: "Blocked",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("gt", 1e9)],
    },
    exit: thresholdRule("gt", 105),
  };
  const result = runOptimization(
    baseConfig(strategy, {
      maxTrials: 8,
      ruleRoles: { "entry.conditions.1": "optional" },
      parameterOverrides: {
        "entry.conditions.0.right.value": { locked: true },
        "entry.conditions.1.right.value": { locked: true },
        "exit.right.value": { locked: true },
      },
      refinement: { enabled: false },
    }),
  );
  const best = result.leaderboard[0];
  assert.ok(best?.score?.eligible);
  assert.equal(best.values["entry.conditions.1.enabled"], false);
  assert.ok(best.score.score > result.baseline.score.score);
});

test("the ablation report covers every active rule of the best candidate", () => {
  const result = runOptimization(curatedThresholdConfig());
  assert.equal(result.ablation.length, 2);
  for (const entry of result.ablation) {
    assert.ok(entry.skipped);
    assert.match(entry.skipReason ?? "", /at least one active rule/);
  }

  const grouped: Strategy = {
    name: "Grouped",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("lt", 200)],
    },
    exit: thresholdRule("gt", 105),
  };
  const groupedResult = runOptimization(baseConfig(grouped, { maxTrials: 6 }));
  const removable = groupedResult.ablation.filter((entry) => !entry.skipped);
  assert.ok(removable.length > 0);
  assert.ok(removable.every((entry) => entry.score != null && entry.scoreDelta != null));
});

test("baseline and buy & hold benchmarks are always evaluated", () => {
  const result = runOptimization(curatedThresholdConfig());
  assert.equal(result.baseline.foldResults.length, 4);
  assert.equal(result.buyHold.foldResults.length, 4);
  assert.equal(result.scoringVersion, "1");
});
