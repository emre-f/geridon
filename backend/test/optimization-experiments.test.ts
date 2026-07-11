import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleCancelExperiment,
  handleCreateExperiment,
  handleDeleteExperiment,
  handleGetExperiment,
  handleListExperiments,
  handleResumeExperiment,
} from "../src/api/optimizationExperiments.ts";
import {
  handleGetExperimentTrial,
  handleListExperimentTrials,
  handleSaveTrialStrategy,
} from "../src/api/optimizationTrials.ts";
import { loadExperimentDatasets } from "../src/api/optimizationRequests.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import { ExperimentRunner } from "../src/services/optimization/experimentRunner.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import type {
  OptimizationExperimentRecord,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "../src/types.ts";
import { thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

function makeRunner(db: Database): ExperimentRunner {
  return new ExperimentRunner(db, (config) => loadExperimentDatasets(db, config));
}

function insertCandles(db: Database, ticker: string, count: number) {
  const insert = db.prepare(
    `INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume, vwap, transactions)
     VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const candle of triangleCandles(count)) {
    insert.run(
      ticker,
      candle.timestamp_ms,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.vwap,
      candle.transactions,
    );
  }
}

function insertStrategy(db: Database): number {
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  return Number(inserted.lastInsertRowid);
}

function experimentBody(strategyId: number, overrides?: Record<string, unknown>) {
  return {
    strategy_id: strategyId,
    tickers: ["TEST"],
    timeframe: "1d",
    start_ms: 0,
    end_ms: 4e12,
    seed: 42,
    max_trials: 12,
    folds: { foldCount: 4, mode: "anchored" },
    scoring: {
      objective: "total_return",
      constraints: { minTotalTrades: 2, maxDrawdownPct: 90, minPositiveFoldFraction: 0.5 },
    },
    parameter_overrides: {
      "entry.right.value": { choices: [90.5, 93, 95] },
      "exit.right.value": { choices: [105, 107, 109.5] },
    },
    ...overrides,
  };
}

async function runToCompletion(
  db: Database,
  runner: ExperimentRunner,
  body: Record<string, unknown>,
): Promise<OptimizationExperimentRecord> {
  const created = handleCreateExperiment(db, runner, body);
  assert.equal(created.statusCode, 201);
  const id = (created.body as OptimizationExperimentRecord).id;
  await runner.waitForFinish(id);
  return getExperiment(db, id)!;
}

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
  assert.ok(experiment.progress && experiment.progress.evaluated_trials > 0);

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

test("cancelling a running experiment keeps its completed trials", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 2000);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const created = handleCreateExperiment(
    db,
    runner,
    experimentBody(strategyId, { max_trials: 500, max_runtime_ms: 60_000 }),
  );
  assert.equal(created.statusCode, 201);
  const id = (created.body as OptimizationExperimentRecord).id;

  const cancelled = handleCancelExperiment(db, runner, String(id));
  assert.equal(cancelled.statusCode, 202);
  await runner.waitForFinish(id);
  const experiment = getExperiment(db, id)!;
  assert.equal(experiment.status, "cancelled");

  const resumed = handleResumeExperiment(db, runner, String(id));
  assert.equal(resumed.statusCode, 202);
  await runner.waitForFinish(id);
  assert.ok(["completed", "cancelled"].includes(getExperiment(db, id)!.status));
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

test("running experiments become interrupted after a restart and can resume", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);

  const firstRunner = makeRunner(db);
  const created = handleCreateExperiment(db, firstRunner, experimentBody(strategyId));
  const id = (created.body as OptimizationExperimentRecord).id;
  firstRunner.cancel(id);
  await firstRunner.waitForFinish(id);
  // Simulate a crash that left the row in the running state.
  db.prepare("UPDATE optimization_experiments SET status = 'running' WHERE id = ?").run(id);

  const secondRunner = makeRunner(db);
  secondRunner.recoverOnBoot();
  assert.equal(getExperiment(db, id)!.status, "interrupted");

  const resumed = handleResumeExperiment(db, secondRunner, String(id));
  assert.equal(resumed.statusCode, 202);
  await secondRunner.waitForFinish(id);
  assert.equal(getExperiment(db, id)!.status, "completed");
});
