import assert from "node:assert/strict";
import { test } from "node:test";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { computeParetoFronts } from "../src/services/optimization/pareto.ts";
import { validateCandidate } from "../src/services/optimization/searchSpace.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type {
  FoldEvaluation,
  OptimizationConfig,
  OptimizationTrial,
  Strategy,
} from "../src/types.ts";

function continuousConfig(method: "random" | "tpe", seed: number): OptimizationConfig {
  return baseConfig(thresholdStrategy(95, 105), {
    method,
    seed,
    maxTrials: 40,
    refinement: { enabled: false },
    parameterOverrides: {
      "entry.right.value": { min: 85, max: 115 },
      "exit.right.value": { min: 85, max: 125 },
    },
  });
}

test("tpe is deterministic for a fixed seed", () => {
  const first = runOptimization(continuousConfig("tpe", 11));
  const second = runOptimization(continuousConfig("tpe", 11));
  assert.equal(first.trials.length, 40);
  assert.deepEqual(
    second.trials.map((trial) => trial.hash),
    first.trials.map((trial) => trial.hash),
  );
});

test("tpe matches or beats seeded random search under an equal budget on the fixture", () => {
  const seeds = [1, 2, 3];
  const bestScore = (method: "random" | "tpe", seed: number) =>
    runOptimization(continuousConfig(method, seed)).leaderboard[0]?.score?.score ?? -Infinity;

  for (const seed of seeds) {
    const randomBest = bestScore("random", seed);
    const tpeBest = bestScore("tpe", seed);
    assert.ok(
      tpeBest >= randomBest,
      `seed ${seed}: tpe best ${tpeBest} should match or beat random best ${randomBest}`,
    );
  }
});

function blockedStrategy(): Strategy {
  return {
    name: "Blocked",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("gt", 1e9)],
    },
    exit: thresholdRule("gt", 105),
  };
}

test("evolution only produces valid candidates within the caps", () => {
  const config = baseConfig(blockedStrategy(), {
    method: "evolution",
    maxTrials: 30,
    ruleRoles: { "entry.conditions.1": "optional" },
    evolution: {
      ruleLibrary: [
        { type: "rule", left: { type: "price", field: "close" }, operator: "lt", right: { type: "value", value: 93 } },
      ],
      maxActiveRulesPerSide: 3,
    },
  });
  const result = runOptimization(config);
  assert.equal(result.trials.length, config.maxTrials);
  for (const trial of result.trials) {
    if (trial.status === "rejected") {
      assert.ok(trial.rejectionReason);
      continue;
    }
    assert.equal(validateCandidate(trial.strategy, "long_only"), null);
    assert.ok(trial.complexity.activeRules <= 3 + 1);
  }
  assert.ok(result.leaderboard.length > 0);
});

test("evolution improves on a baseline blocked by a harmful rule", () => {
  const result = runOptimization(
    baseConfig(blockedStrategy(), {
      method: "evolution",
      maxTrials: 40,
      ruleRoles: { "entry.conditions.1": "optional" },
    }),
  );
  const best = result.leaderboard[0];
  assert.ok(best?.score);
  assert.ok(best.score.eligible);
  assert.ok(best.score.score > result.baseline.score.score);
});

test("evolution can insert approved library rules and dedups candidates", () => {
  const config = baseConfig(blockedStrategy(), {
    method: "evolution",
    maxTrials: 40,
    ruleRoles: { "entry.conditions.1": "optional" },
    evolution: {
      ruleLibrary: [
        { type: "rule", left: { type: "price", field: "close" }, operator: "lt", right: { type: "value", value: 92 } },
      ],
    },
  });
  const result = runOptimization(config);
  const baseRuleCount = 3;
  const withAddedRule = result.trials.filter((trial) => {
    if (trial.status === "rejected") {
      return false;
    }
    const entry = trial.strategy.entry;
    return entry.type === "group" && entry.conditions.length > 2;
  });
  assert.ok(withAddedRule.length > 0);
  assert.ok(withAddedRule.every((trial) => trial.complexity.activeRules <= baseRuleCount + 2));
  const duplicates = result.trials.filter(
    (trial) => /duplicate/.test(trial.rejectionReason ?? ""),
  );
  assert.ok(duplicates.length > 0);
});

function fakeTrial(
  index: number,
  objective: number,
  drawdown: number,
  trades: number,
  activeRules: number,
): OptimizationTrial {
  const fold: FoldEvaluation = {
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
  return {
    index,
    hash: String(index),
    values: {},
    strategy: thresholdStrategy(95, 105),
    status: "scored",
    stageReached: 0,
    foldResults: [fold],
    score: {
      score: objective,
      medianObjective: objective,
      eligible: true,
      ineligibilityReasons: [],
      penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
    },
    complexity: { activeRules, uniqueIndicators: 0, maxDepth: 1 },
    phase: "search",
  };
}

test("pareto fronts separate dominated from non-dominated candidates", () => {
  const dominant = fakeTrial(0, 20, -5, 4, 2);
  const tradeoff = fakeTrial(1, 25, -15, 4, 2);
  const dominated = fakeTrial(2, 10, -10, 8, 4);
  const fronts = computeParetoFronts([dominant, tradeoff, dominated]);
  assert.deepEqual(fronts[0].sort(), [0, 1]);
  assert.deepEqual(fronts[1], [2]);
});

test("pareto fronts are attached to optimization results", () => {
  const result = runOptimization(continuousConfig("random", 5));
  assert.ok(result.paretoFronts.length > 0);
  const frontIndexes = new Set(result.paretoFronts.flat());
  assert.equal(frontIndexes.size, result.leaderboard.length);
});
