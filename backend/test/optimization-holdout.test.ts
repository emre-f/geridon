import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { handleOpenTrialHoldout } from "../src/api/optimizationHoldout.ts";
import { loadExperimentDatasets } from "../src/api/optimizationRequests.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import { ExperimentRunner } from "../src/services/optimization/experimentRunner.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import {
  holdoutFoldSpec,
  searchDatasets,
  validateHoldoutSize,
} from "../src/services/optimization/holdout.ts";
import type { HoldoutEvaluation, OptimizationExperimentRecord } from "../src/types.ts";
import { thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
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

async function completedExperiment(
  db: Database,
  overrides?: Record<string, unknown>,
): Promise<OptimizationExperimentRecord> {
  insertCandles(db, "TEST", 400);
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const runner = new ExperimentRunner(db, (config) => loadExperimentDatasets(db, config));
  const created = handleCreateExperiment(db, runner, {
    strategy_id: Number(inserted.lastInsertRowid),
    tickers: ["TEST"],
    timeframe: "1d",
    start_ms: 0,
    end_ms: 4e12,
    seed: 42,
    max_trials: 12,
    folds: { foldCount: 4, mode: "anchored" },
    holdout: { fraction: 0.2 },
    scoring: {
      objective: "total_return",
      constraints: { minTotalTrades: 2, maxDrawdownPct: 90, minPositiveFoldFraction: 0.5 },
    },
    parameter_overrides: {
      "entry.right.value": { choices: [90.5, 93, 95] },
      "exit.right.value": { choices: [105, 107, 109.5] },
    },
    ...overrides,
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = (created.body as OptimizationExperimentRecord).id;
  await runner.waitForFinish(id);
  const experiment = getExperiment(db, id)!;
  assert.equal(experiment.status, "completed");
  return experiment;
}

test("holdout split math seals the trailing window", () => {
  const datasets = [{ symbol: "TEST", candles: triangleCandles(400) }];
  const search = searchDatasets(datasets, { fraction: 0.2 });
  assert.equal(search[0].candles.length, 320);
  assert.equal(
    search[0].candles.at(-1)!.timestamp_ms,
    datasets[0].candles[319].timestamp_ms,
  );
  assert.equal(searchDatasets(datasets, undefined), datasets);

  const fold = holdoutFoldSpec(400, 80);
  assert.deepEqual(fold, {
    index: 0,
    trainStartIndex: 0,
    trainEndIndex: 319,
    validStartIndex: 320,
    validEndIndex: 399,
  });

  assert.equal(validateHoldoutSize("TEST", 400, { fraction: 0.2 }), null);
  assert.match(validateHoldoutSize("TEST", 20, { fraction: 0.05 })!, /only 1 candles/);
});

test("search and validation never touch sealed holdout candles", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);

  const spec = experiment.snapshot.datasets[0];
  assert.equal(spec.candle_count, 400);
  assert.equal(spec.holdout_candle_count, 80);

  const allCandles = triangleCandles(400);
  const firstSealedMs = allCandles[320].timestamp_ms;
  const summary = experiment.summary!;
  const validationFolds = [
    ...summary.baseline.foldResults,
    ...summary.buy_hold.foldResults,
  ];
  assert.ok(validationFolds.length > 0);
  const searchCandleTotal = summary.baseline.foldResults.reduce(
    (sum, fold) => sum + fold.candle_count,
    0,
  );
  assert.ok(searchCandleTotal <= 320, "validation folds must fit inside the search portion");

  const rows = db
    .prepare("SELECT fold_results FROM optimization_trials WHERE fold_results IS NOT NULL")
    .all() as Array<{ fold_results: string }>;
  for (const row of rows) {
    for (const fold of JSON.parse(row.fold_results) as Array<{ candle_count: number }>) {
      assert.ok(fold.candle_count <= 320);
    }
  }
  assert.ok(firstSealedMs > 0);
});

test("opening the holdout evaluates candidate, baseline, and buy & hold once", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);
  const bestIndex = experiment.summary!.best_trial_index!;

  const before = Date.now();
  const response = handleOpenTrialHoldout(db, experiment, String(bestIndex));
  assert.equal(response.statusCode, 200);
  const body = response.body as HoldoutEvaluation;
  assert.equal(body.trial_index, bestIndex);
  assert.ok(new Date(body.opened_at).getTime() >= before - 1000);
  for (const results of [body.candidate, body.baseline, body.buy_hold]) {
    assert.equal(results.length, 1);
    assert.equal(results[0].symbol, "TEST");
    assert.equal(results[0].candle_count, 80);
  }

  const reloaded = getExperiment(db, experiment.id)!;
  assert.deepEqual(reloaded.holdout, body);
  assert.deepEqual(reloaded.summary, experiment.summary, "holdout must not feed back into search results");

  const repeat = handleOpenTrialHoldout(db, reloaded, String(bestIndex));
  assert.equal(repeat.statusCode, 200);
  assert.deepEqual(repeat.body, body);

  const otherTrial = experiment.summary!.best_trial_index === 0 ? 1 : 0;
  const second = handleOpenTrialHoldout(db, reloaded, String(otherTrial));
  assert.equal(second.statusCode, 409);
  assert.match((second.body as { detail: string }).detail, /already opened/);
});

test("holdout endpoint rejects invalid requests", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);
  assert.equal(handleOpenTrialHoldout(db, experiment, "abc").statusCode, 400);
  assert.equal(handleOpenTrialHoldout(db, experiment, "9999").statusCode, 404);

  const withoutHoldout = await (async () => {
    const db2 = makeDb();
    return {
      db: db2,
      experiment: await completedExperiment(db2, { holdout: undefined }),
    };
  })();
  const bestIndex = withoutHoldout.experiment.summary!.best_trial_index!;
  const response = handleOpenTrialHoldout(
    withoutHoldout.db,
    withoutHoldout.experiment,
    String(bestIndex),
  );
  assert.equal(response.statusCode, 400);
  assert.match((response.body as { detail: string }).detail, /without a sealed holdout/);
});

test("experiment creation validates the holdout fraction and size", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const runner = new ExperimentRunner(db, (config) => loadExperimentDatasets(db, config));
  const base = {
    strategy_id: Number(inserted.lastInsertRowid),
    tickers: ["TEST"],
    timeframe: "1d",
    start_ms: 0,
    end_ms: 4e12,
    parameter_overrides: { "entry.right.value": { choices: [90.5, 93] } },
  };

  const badFraction = handleCreateExperiment(db, runner, { ...base, holdout: { fraction: 0.9 } });
  assert.equal(badFraction.statusCode, 400);
  assert.match((badFraction.body as { detail: string }).detail, /holdout\.fraction/);

  const tooManyFolds = handleCreateExperiment(db, runner, {
    ...base,
    holdout: { fraction: 0.4 },
    folds: { foldCount: 12, mode: "anchored", minValidationCandles: 30 },
  });
  assert.equal(tooManyFolds.statusCode, 400);
  assert.match(
    (tooManyFolds.body as { detail: string }).detail,
    /Not enough candles/,
    "fold validation must run on the search portion, not the full range",
  );
});
