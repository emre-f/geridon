import assert from "node:assert/strict";
import { test } from "node:test";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import type { OptimizationConfig, OptimizationDataset, Strategy } from "../src/types.ts";
import {
  baseConfig,
  dataset,
  regimeDataset,
  thresholdRule,
  thresholdStrategy,
} from "./optimizationFixtures.ts";

/**
 * Section 10 criterion: under an equal evaluation budget, every smarter search
 * method is compared against seeded random search across several strategies,
 * tickers, and seeds; no method is judged from one strategy or ticker.
 */

const seeds = [1, 2, 3];

function datasetVariants(): Array<{ name: string; datasets: OptimizationDataset[] }> {
  return [
    { name: "triangle", datasets: [dataset()] },
    { name: "regime", datasets: [regimeDataset()] },
    {
      name: "two-symbol basket",
      datasets: [dataset(), { ...regimeDataset(), symbol: "REGIME" }],
    },
  ];
}

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

async function bestScore(config: OptimizationConfig): Promise<number> {
  return (await runOptimization(config)).leaderboard[0]?.score?.score ?? -Infinity;
}

async function compareAcrossMatrix(
  makeConfig: (
    method: "random" | "tpe" | "evolution",
    datasets: OptimizationDataset[],
    seed: number,
  ) => OptimizationConfig,
  smarter: "tpe" | "evolution",
) {
  const cells: Array<{ name: string; seed: number; random: number; smart: number }> = [];
  for (const variant of datasetVariants()) {
    for (const seed of seeds) {
      cells.push({
        name: variant.name,
        seed,
        random: await bestScore(makeConfig("random", variant.datasets, seed)),
        smart: await bestScore(makeConfig(smarter, variant.datasets, seed)),
      });
    }
  }

  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const meanRandom = mean(cells.map((cell) => cell.random));
  const meanSmart = mean(cells.map((cell) => cell.smart));
  const winsOrTies = cells.filter((cell) => cell.smart >= cell.random).length;
  const detail = cells
    .map((c) => `${c.name} seed ${c.seed}: ${smarter}=${c.smart.toFixed(4)} random=${c.random.toFixed(4)}`)
    .join("\n");

  assert.ok(
    meanSmart >= meanRandom,
    `${smarter} mean best score ${meanSmart} fell below random's ${meanRandom} across the matrix:\n${detail}`,
  );
  assert.ok(
    winsOrTies >= Math.ceil(cells.length * (2 / 3)),
    `${smarter} won or tied only ${winsOrTies}/${cells.length} cells:\n${detail}`,
  );
}

test("tpe matches or beats random search across strategies, tickers, and seeds under equal budgets", async () => {
  await compareAcrossMatrix(
    (method, datasets, seed) =>
      baseConfig(thresholdStrategy(95, 105), {
        method: method as "random" | "tpe",
        datasets,
        seed,
        maxTrials: 40,
        refinement: { enabled: false },
        parameterOverrides: {
          "entry.right.value": { min: 85, max: 115 },
          "exit.right.value": { min: 85, max: 125 },
        },
      }),
    "tpe",
  );
});

test("evolution matches or beats random search across strategies, tickers, and seeds under equal budgets", async () => {
  await compareAcrossMatrix(
    (method, datasets, seed) =>
      baseConfig(blockedStrategy(), {
        method,
        datasets,
        seed,
        maxTrials: 40,
        refinement: { enabled: false },
        ruleRoles: { "entry.conditions.1": "optional" },
      }),
    "evolution",
  );
});
