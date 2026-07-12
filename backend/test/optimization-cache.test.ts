import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateOnFolds, type EvaluationSettings } from "../src/services/optimization/evaluate.ts";
import { buildFolds } from "../src/services/optimization/folds.ts";
import { createIndicatorSeriesCache } from "../src/services/optimization/indicatorCache.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import type { Strategy } from "../src/types.ts";
import { baseConfig, dataset } from "./optimizationFixtures.ts";

function smaCrossStrategy(fastPeriod: number, slowPeriod: number): Strategy {
  const fast = {
    type: "indicator",
    kind: "sma",
    parameters: { period: fastPeriod },
    output: "sma",
  } as const;
  const slow = {
    type: "indicator",
    kind: "sma",
    parameters: { period: slowPeriod },
    output: "sma",
  } as const;
  return {
    name: "SMA Cross",
    entry: { type: "rule", left: fast, operator: "cross_above", right: slow },
    exit: { type: "rule", left: fast, operator: "cross_below", right: slow },
  };
}

test("the cache evicts the least recently used series once past its value budget", () => {
  const cache = createIndicatorSeriesCache(10);
  const scope = cache.scope("TEST", 0, 99);
  scope.set("a", [1, 2, 3, 4]);
  scope.set("b", [5, 6, 7, 8]);
  assert.deepEqual(scope.get("a"), [1, 2, 3, 4]);
  scope.set("c", [9, 10, 11, 12]);
  assert.equal(scope.get("b"), undefined);
  assert.deepEqual(scope.get("a"), [1, 2, 3, 4]);
  assert.deepEqual(scope.get("c"), [9, 10, 11, 12]);
  assert.equal(cache.stats.evictions, 1);
  assert.equal(cache.size, 2);

  scope.set("too-big", Array(11).fill(0));
  assert.equal(scope.get("too-big"), undefined);
});

test("scopes for different symbols or candle ranges never share series", () => {
  const cache = createIndicatorSeriesCache();
  cache.scope("TEST", 0, 50).set("sma", [1]);
  assert.equal(cache.scope("TEST", 0, 60).get("sma"), undefined);
  assert.equal(cache.scope("TEST", 1, 50).get("sma"), undefined);
  assert.equal(cache.scope("OTHER", 0, 50).get("sma"), undefined);
  assert.deepEqual(cache.scope("TEST", 0, 50).get("sma"), [1]);
});

test("candidates reuse cached indicator series and results stay identical", () => {
  const datasets = [dataset(400)];
  const foldsBySymbol = new Map([["TEST", buildFolds(400, { foldCount: 4, mode: "anchored" })]]);
  const cache = createIndicatorSeriesCache();
  const settings: EvaluationSettings = {
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    objective: "total_return",
    cache,
  };

  const first = evaluateOnFolds(smaCrossStrategy(5, 12), datasets, foldsBySymbol, settings);
  assert.equal(cache.stats.misses, 8);
  assert.equal(cache.stats.hits, 0);

  const repeat = evaluateOnFolds(smaCrossStrategy(5, 12), datasets, foldsBySymbol, settings);
  assert.equal(cache.stats.misses, 8);
  assert.equal(cache.stats.hits, 8);
  assert.deepEqual(repeat, first);

  evaluateOnFolds(smaCrossStrategy(5, 20), datasets, foldsBySymbol, settings);
  assert.equal(cache.stats.hits, 12);
  assert.equal(cache.stats.misses, 12);
});

test("cached and uncached optimizations match byte for byte", () => {
  const config = baseConfig(smaCrossStrategy(5, 12), { maxTrials: 16 });
  const uncached = runOptimization({ ...config, cache: { enabled: false } });
  const cached = runOptimization(config);
  const evicting = runOptimization({ ...config, cache: { maxValues: 500 } });
  assert.equal(JSON.stringify(cached), JSON.stringify(uncached));
  assert.equal(JSON.stringify(evicting), JSON.stringify(uncached));
});
