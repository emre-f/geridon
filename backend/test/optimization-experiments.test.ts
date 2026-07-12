import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleCreateExperiment,
  handleDeleteExperiment,
  handleGetExperiment,
  handleListExperiments,
} from "../src/api/optimizationExperiments.ts";
import {
  handleGetExperimentTrial,
  handleListExperimentTrials,
  handleSaveTrialStrategy,
} from "../src/api/optimizationTrials.ts";
import type {
  OptimizationExperimentRecord,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";

test("an experiment runs to completion and persists ranked trials", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const experiment = await runToCompletion(db, runner, experimentBody(strategyId));
  assert.equal(experiment.status, "completed");
  assert.ok(experiment.summary);
  assert.ok(experiment.summary.baseline.score);
  assert.ok(experiment.summary.trial_counts.scored > 0);
  assert.notEqual(experiment.summary.best_trial_index, null);
  assert.equal(experiment.snapshot.datasets[0].candle_count, 400);
  assert.equal(experiment.snapshot.catalog_version, 1);
  assert.equal(experiment.snapshot.search_space_version, 1);
  assert.ok(experiment.progress && experiment.progress.evaluated_trials > 0);
  assert.equal(experiment.progress?.evaluated_trials, experiment.config.max_trials);
  assert.equal(experiment.progress?.max_trials, experiment.config.max_trials);

  const listed = handleListExperiments(db, new URLSearchParams());
  assert.equal((listed.body as { total: number }).total, 1);

  const trials = handleListExperimentTrials(db, experiment, new URLSearchParams("limit=5"));
  assert.equal(trials.statusCode, 200);
  const trialBody = trials.body as { total: number; trials: OptimizationTrialRecord[] };
  assert.ok(trialBody.total > 5);
  assert.equal(trialBody.trials.length, 5);
  assert.equal(trialBody.trials[0].rank, 1);
  assert.equal(trialBody.trials[0].trial_index, experiment.summary.best_trial_index);

  const detail = handleGetExperimentTrial(
    db,
    experiment,
    String(experiment.summary.best_trial_index),
  );
  assert.equal(detail.statusCode, 200);
  const trialDetail = detail.body as OptimizationTrialDetail;
  assert.ok(trialDetail.strategy);
  assert.ok(trialDetail.fold_results.length > 0);
  assert.ok(trialDetail.score?.eligible);
});

test("identical experiment configs reproduce the same best candidate", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const first = await runToCompletion(db, runner, experimentBody(strategyId));
  const second = await runToCompletion(db, runner, experimentBody(strategyId));
  const bestHash = (experiment: OptimizationExperimentRecord) =>
    (handleGetExperimentTrial(db, experiment, String(experiment.summary!.best_trial_index))
      .body as OptimizationTrialDetail).hash;
  assert.equal(bestHash(second), bestHash(first));
});

test("invalid configurations return structured errors", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  insertCandles(db, "TINY", 12);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const lockedOverrides = {
    "entry.right.value": { locked: true },
    "exit.right.value": { locked: true },
  };
  const cases: Array<[Record<string, unknown>, number]> = [
    [{ strategy_id: strategyId }, 400],
    [experimentBody(999), 404],
    [experimentBody(strategyId, { max_trials: 10_000 }), 400],
    [experimentBody(strategyId, { tickers: ["TINY"] }), 400],
    [experimentBody(strategyId, { parameter_overrides: lockedOverrides }), 400],
    [experimentBody(strategyId, { costs: { commission_pct: -1 } }), 400],
    [experimentBody(strategyId, { costs: { spread: 1 } }), 400],
    [experimentBody(strategyId, { folds: { foldCount: 4, embargoCandles: -1 } }), 400],
    [experimentBody(strategyId, { folds: { foldCount: 4, embargoCandles: 251 } }), 400],
    [experimentBody(strategyId, { folds: { foldCount: 4, embargoCandles: 79 } }), 400],
  ];
  for (const [body, statusCode] of cases) {
    assert.equal(handleCreateExperiment(db, runner, body).statusCode, statusCode);
  }
});

test("trade costs are stored in the experiment config and lower returns", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const costs = { commission_per_trade: 5, commission_pct: 0.5, slippage_bps: 25 };
  const withCosts = await runToCompletion(db, runner, experimentBody(strategyId, { costs }));
  assert.deepEqual(withCosts.config.costs, costs);
  assert.equal(withCosts.status, "completed");

  const frictionless = await runToCompletion(db, runner, experimentBody(strategyId));
  assert.deepEqual(frictionless.config.costs, {
    commission_per_trade: 0,
    commission_pct: 0,
    slippage_bps: 0,
  });

  const costObjective = withCosts.summary!.baseline.score.medianObjective;
  const freeObjective = frictionless.summary!.baseline.score.medianObjective;
  assert.ok(costObjective < freeObjective);
});

test("a candidate saved as a strategy survives experiment deletion", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const experiment = await runToCompletion(db, runner, experimentBody(strategyId));
  const saved = handleSaveTrialStrategy(
    db,
    experiment,
    String(experiment.summary!.best_trial_index),
    {},
  );
  assert.equal(saved.statusCode, 201);
  const savedId = (saved.body as { id: number; name: string }).id;
  assert.notEqual(savedId, strategyId);
  assert.match((saved.body as { name: string }).name, /exp \d+ trial \d+/);

  const deleted = handleDeleteExperiment(db, runner, String(experiment.id));
  assert.equal(deleted.statusCode, 200);
  assert.equal(handleGetExperiment(db, String(experiment.id)).statusCode, 404);
  assert.ok(db.prepare("SELECT 1 FROM strategies WHERE id = ?").get(savedId));
  const remaining = db
    .prepare("SELECT COUNT(*) AS count FROM optimization_trials WHERE experiment_id = ?")
    .get(experiment.id) as { count: number };
  assert.equal(Number(remaining.count), 0);
});
