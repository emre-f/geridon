import assert from "node:assert/strict";
import { test } from "node:test";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { OptimizationConfig, Strategy } from "../src/types.ts";

function tunable(method: "random" | "tpe" | "evolution", workerCount: number): OptimizationConfig {
  const strategy: Strategy =
    method === "evolution"
      ? {
          name: "Blocked",
          entry: {
            type: "group",
            operator: "and",
            conditions: [thresholdRule("lt", 95), thresholdRule("gt", 1e9)],
          },
          exit: thresholdRule("gt", 105),
        }
      : thresholdStrategy(95, 105);
  return baseConfig(strategy, {
    method,
    seed: 7,
    maxTrials: 30,
    workerCount,
    ...(method === "evolution" ? { ruleRoles: { "entry.conditions.1": "optional" } } : {}),
    parameterOverrides: {
      "entry.right.value": { min: 88, max: 99 },
      "exit.right.value": { min: 102, max: 112 },
    },
  });
}

for (const method of ["random", "tpe", "evolution"] as const) {
  test(`${method} search is byte-identical across 1 and 4 workers`, async () => {
    const serial = await runOptimization(tunable(method, 1));
    const parallel = await runOptimization(tunable(method, 4));
    assert.equal(JSON.stringify(parallel), JSON.stringify(serial));
  });
}

test("a multi-symbol experiment stays identical when parallelized", async () => {
  const config = (workerCount: number): OptimizationConfig => ({
    ...baseConfig(thresholdStrategy(95, 105), {
      seed: 3,
      maxTrials: 24,
      workerCount,
      parameterOverrides: {
        "entry.right.value": { min: 88, max: 99 },
        "exit.right.value": { min: 102, max: 112 },
      },
    }),
    datasets: [
      { symbol: "A", candles: baseConfig(thresholdStrategy(95, 105)).datasets[0].candles },
      { symbol: "B", candles: baseConfig(thresholdStrategy(95, 105)).datasets[0].candles },
    ],
  });
  const serial = await runOptimization(config(1));
  const parallel = await runOptimization(config(6));
  assert.equal(JSON.stringify(parallel), JSON.stringify(serial));
  assert.ok(serial.leaderboard.length > 0);
});
