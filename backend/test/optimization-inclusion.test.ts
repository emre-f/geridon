import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRuleInclusion } from "../src/services/optimization/inclusion.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { OptimizationTrial, Strategy } from "../src/types.ts";

function groupedStrategy(secondRuleEnabled: boolean, secondRuleValue = 100): Strategy {
  return {
    name: "Grouped",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("gt", secondRuleValue, secondRuleEnabled)],
    },
    exit: thresholdRule("gt", 105),
  };
}

function scoredTrial(index: number, strategy: Strategy, eligible = true): OptimizationTrial {
  return {
    index,
    hash: `hash-${index}`,
    values: {},
    strategy,
    status: "scored",
    stageReached: 2,
    foldResults: [],
    score: {
      score: 1 - index * 0.1,
      medianObjective: 1,
      eligible,
      ineligibilityReasons: [],
      penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
    },
    complexity: { activeRules: 3, uniqueIndicators: 0, maxDepth: 2 },
    phase: "search",
  };
}

test("computeRuleInclusion counts active rules among the top eligible candidates", async () => {
  const baseline = groupedStrategy(true);
  const leaderboard = [
    scoredTrial(0, groupedStrategy(true)),
    scoredTrial(1, groupedStrategy(false)),
    scoredTrial(2, groupedStrategy(true)),
  ];

  const entries = computeRuleInclusion(leaderboard, baseline);
  assert.deepEqual(
    entries.map((entry) => [entry.ruleId, entry.includedCount, entry.topCount]),
    [
      ["entry.conditions.0", 3, 3],
      ["exit", 3, 3],
      ["entry.conditions.1", 2, 3],
    ],
  );
});

test("computeRuleInclusion skips ineligible candidates and respects topCount", async () => {
  const baseline = groupedStrategy(true);
  const leaderboard = [
    scoredTrial(0, groupedStrategy(false)),
    scoredTrial(1, groupedStrategy(true), false),
    scoredTrial(2, groupedStrategy(true)),
  ];

  const all = computeRuleInclusion(leaderboard, baseline);
  const secondRule = all.find((entry) => entry.ruleId === "entry.conditions.1");
  assert.deepEqual(
    { includedCount: secondRule?.includedCount, topCount: secondRule?.topCount },
    { includedCount: 1, topCount: 2 },
  );

  const onlyBest = computeRuleInclusion(leaderboard, baseline, 1);
  assert.equal(onlyBest.find((entry) => entry.ruleId === "entry.conditions.1")?.includedCount, 0);
  assert.ok(onlyBest.every((entry) => entry.topCount === 1));
});

test("computeRuleInclusion labels rules from the baseline snapshot, not tuned candidates", async () => {
  const baseline = groupedStrategy(true, 100);
  const leaderboard = [scoredTrial(0, groupedStrategy(true, 999))];

  const entries = computeRuleInclusion(leaderboard, baseline);
  const secondRule = entries.find((entry) => entry.ruleId === "entry.conditions.1");
  assert.equal(secondRule?.summary, "entry: close gt 100");
});

test("computeRuleInclusion returns nothing without eligible candidates", async () => {
  const baseline = groupedStrategy(true);
  assert.deepEqual(computeRuleInclusion([scoredTrial(0, baseline, false)], baseline), []);
});

test("optimization reports inclusion frequency when rule structure is searched", async () => {
  const strategy: Strategy = {
    name: "Blocked",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("gt", 1e9)],
    },
    exit: thresholdRule("gt", 105),
  };
  const result = await runOptimization(
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

  const eligibleCount = result.leaderboard.filter((trial) => trial.score?.eligible).length;
  assert.ok(eligibleCount > 0);
  assert.ok(result.inclusion.length >= 3);
  assert.ok(result.inclusion.every((entry) => entry.topCount === Math.min(eligibleCount, 10)));

  const blockedRule = result.inclusion.find((entry) => entry.ruleId === "entry.conditions.1");
  assert.equal(blockedRule?.includedCount, 0);
});

test("optimization reports no inclusion for a pure parameter search", async () => {
  const result = await runOptimization(baseConfig(thresholdStrategy(95, 105), { maxTrials: 8 }));
  assert.deepEqual(result.inclusion, []);
});
