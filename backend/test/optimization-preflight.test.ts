import assert from "node:assert/strict";
import { test } from "node:test";

import { handlePreflightExperiment } from "../src/api/optimizationPreflight.ts";
import { buildFolds } from "../src/services/optimization/folds.ts";
import { planEvaluations } from "../src/services/optimization/preflight.ts";
import type { ExperimentPreflight, FoldSpec } from "../src/types.ts";
import { experimentBody, insertCandles, insertStrategy, makeDb } from "./experimentTestHelpers.ts";

function foldsFor(candleCount: number, symbols = ["TEST"]): Map<string, FoldSpec[]> {
  const map = new Map<string, FoldSpec[]>();
  for (const symbol of symbols) {
    map.set(symbol, buildFolds(candleCount, { foldCount: 4, mode: "anchored" }));
  }
  return map;
}

test("planEvaluations counts random search through the halving schedule", () => {
  const plan = planEvaluations({
    method: "random",
    maxTrials: 12,
    foldsBySymbol: foldsFor(60),
    activeRuleCount: 2,
  });
  // Default refinement keeps max(4, 12/4) = 4 trials, so 8 search trials go
  // through halving: stages see 2, 1, and 1 new folds with 8, 3, 1 survivors.
  assert.equal(plan.search, 8 * 2 + 3 * 1 + 1 * 1);
  assert.equal(plan.refinement, 4 * 4);
  assert.equal(plan.baseline_and_benchmarks, 8);
  assert.equal(plan.ablation_max, 8);
  assert.equal(plan.total, 20 + 16 + 8 + 8);
});

test("planEvaluations evaluates tpe and evolution trials on every fold", () => {
  const tpe = planEvaluations({
    method: "tpe",
    maxTrials: 12,
    foldsBySymbol: foldsFor(60),
    activeRuleCount: 2,
  });
  assert.equal(tpe.search, 8 * 4);
  assert.equal(tpe.refinement, 4 * 4);

  const evolution = planEvaluations({
    method: "evolution",
    maxTrials: 12,
    foldsBySymbol: foldsFor(60),
    activeRuleCount: 2,
  });
  assert.equal(evolution.search, 12 * 4);
  assert.equal(evolution.refinement, 0);
});

test("planEvaluations respects disabled refinement and multiple symbols", () => {
  const noRefinement = planEvaluations({
    method: "random",
    maxTrials: 12,
    foldsBySymbol: foldsFor(60),
    refinement: { enabled: false },
    activeRuleCount: 2,
  });
  assert.equal(noRefinement.search, 12 * 2 + 4 * 1 + 2 * 1);
  assert.equal(noRefinement.refinement, 0);

  const twoSymbols = planEvaluations({
    method: "random",
    maxTrials: 12,
    foldsBySymbol: foldsFor(60, ["A", "B"]),
    activeRuleCount: 2,
  });
  assert.equal(twoSymbols.search, 8 * 4 + 3 * 2 + 1 * 2);
  assert.equal(twoSymbols.baseline_and_benchmarks, 16);
});

test("preflight returns estimate, benchmark, and data-role timeline", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 60);
  const strategyId = insertStrategy(db);

  const result = handlePreflightExperiment(db, experimentBody(strategyId));
  assert.equal(result.statusCode, 200);
  const preflight = result.body as ExperimentPreflight;

  const parts = preflight.evaluations;
  assert.equal(
    parts.total,
    parts.search + parts.refinement + parts.baseline_and_benchmarks + parts.ablation_max,
  );
  assert.ok(parts.total > 0);
  assert.equal(preflight.benchmark.fold_backtests, 4);
  assert.ok(preflight.benchmark.ms_per_evaluation > 0);
  assert.equal(
    preflight.estimated_runtime_ms,
    Math.round(parts.total * preflight.benchmark.ms_per_evaluation),
  );
  assert.equal(preflight.max_runtime_ms, 120_000);
  assert.equal(typeof preflight.runtime_capped, "boolean");

  assert.equal(preflight.timeline.length, 1);
  const timeline = preflight.timeline[0];
  assert.equal(timeline.ticker, "TEST");
  assert.equal(timeline.candle_count, 60);
  assert.equal(timeline.search_candle_count, 60);
  assert.equal(timeline.holdout, null);
  assert.equal(timeline.folds.length, 4);
  for (const fold of timeline.folds) {
    assert.ok(fold.train_start_ms <= fold.train_end_ms);
    assert.ok(fold.train_end_ms < fold.valid_start_ms);
    assert.ok(fold.valid_start_ms <= fold.valid_end_ms);
    assert.ok(fold.valid_end_ms <= timeline.search_end_ms);
  }
  assert.ok(timeline.folds[0].valid_start_ms < timeline.folds[3].valid_start_ms);
});

test("preflight with a holdout seals the trailing window from the folds", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 60);
  const strategyId = insertStrategy(db);

  const result = handlePreflightExperiment(
    db,
    experimentBody(strategyId, { holdout: { fraction: 0.2 } }),
  );
  assert.equal(result.statusCode, 200);
  const timeline = (result.body as ExperimentPreflight).timeline[0];

  assert.equal(timeline.search_candle_count, 48);
  assert.ok(timeline.holdout);
  assert.equal(timeline.holdout.candle_count, 12);
  assert.ok(timeline.holdout.start_ms > timeline.search_end_ms);
  for (const fold of timeline.folds) {
    assert.ok(fold.valid_end_ms <= timeline.search_end_ms);
  }
});

test("preflight persists nothing and is deterministic apart from timing", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 60);
  const strategyId = insertStrategy(db);

  const first = handlePreflightExperiment(db, experimentBody(strategyId));
  const second = handlePreflightExperiment(db, experimentBody(strategyId));
  assert.equal(first.statusCode, 200);
  const firstBody = first.body as ExperimentPreflight;
  const secondBody = second.body as ExperimentPreflight;
  assert.deepEqual(firstBody.evaluations, secondBody.evaluations);
  assert.deepEqual(firstBody.timeline, secondBody.timeline);

  const count = db.prepare("SELECT COUNT(*) AS n FROM optimization_experiments").get() as {
    n: number;
  };
  assert.equal(Number(count.n), 0);
});

test("preflight rejects unknown strategies and impossible fold configurations", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 20);
  const strategyId = insertStrategy(db);

  const missing = handlePreflightExperiment(db, experimentBody(strategyId + 99));
  assert.equal(missing.statusCode, 404);

  const starved = handlePreflightExperiment(db, experimentBody(strategyId));
  assert.equal(starved.statusCode, 400);
  assert.match(String((starved.body as { detail: string }).detail), /^TEST: Not enough candles/);
});
