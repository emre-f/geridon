import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import {
  handleGetTrialEquity,
  handleListExperimentTrials,
} from "../src/api/optimizationTrials.ts";
import { loadExperimentDatasets } from "../src/api/optimizationRequests.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import { ExperimentRunner } from "../src/services/optimization/experimentRunner.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import type {
  OptimizationExperimentRecord,
  OptimizationTrialRecord,
  TrialEquityResponse,
} from "../src/types.ts";
import { candle, thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

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

async function completedExperiment(db: Database): Promise<OptimizationExperimentRecord> {
  insertCandles(db, "TEST", 400);
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const runner = new ExperimentRunner(db, (config, strategy) => loadExperimentDatasets(db, config, strategy));
  const created = handleCreateExperiment(db, runner, {
    strategy_id: Number(inserted.lastInsertRowid),
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
  });
  assert.equal(created.statusCode, 201);
  const id = (created.body as OptimizationExperimentRecord).id;
  await runner.waitForFinish(id);
  const experiment = getExperiment(db, id)!;
  assert.equal(experiment.status, "completed");
  return experiment;
}

test("trial equity recomputes per-fold validation curves for candidate and baseline", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);
  const bestIndex = experiment.summary!.best_trial_index!;

  const response = handleGetTrialEquity(db, experiment, String(bestIndex));
  assert.equal(response.statusCode, 200);
  const body = response.body as TrialEquityResponse;
  assert.equal(body.trial_index, bestIndex);
  assert.equal(body.initial_capital, experiment.config.initial_capital);

  const foldCount = experiment.config.folds.foldCount;
  assert.equal(body.candidate.length, foldCount);
  assert.equal(body.baseline.length, foldCount);
  for (const curves of [body.candidate, body.baseline]) {
    for (const curve of curves) {
      assert.equal(curve.symbol, "TEST");
      assert.ok(curve.points.length > 0);
      assert.ok(curve.points.every((point) => point.equity > 0));
    }
  }

  const baselineFolds = experiment.summary!.baseline.foldResults;
  for (const fold of baselineFolds) {
    const curve = body.baseline.find(
      (candidate) => candidate.symbol === fold.symbol && candidate.foldIndex === fold.foldIndex,
    )!;
    assert.equal(curve.points.length, fold.candle_count);
    const finalEquity = curve.points[curve.points.length - 1].equity;
    const returnPct = (finalEquity / body.initial_capital - 1) * 100;
    assert.ok(Math.abs(returnPct - fold.total_return_pct) < 1e-9);
  }

  // Validation windows tile the timeline chronologically without overlap.
  const ordered = [...body.candidate].sort((a, b) => a.foldIndex - b.foldIndex);
  for (let index = 1; index < ordered.length; index += 1) {
    const previousEnd = ordered[index - 1].points.at(-1)!.timestamp_ms;
    const nextStart = ordered[index].points[0].timestamp_ms;
    assert.ok(nextStart > previousEnd);
  }
});

test("trial equity is deterministic across calls and persists nothing", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);
  const bestIndex = experiment.summary!.best_trial_index!;
  const runsBefore = db.prepare("SELECT COUNT(*) AS count FROM backtest_runs").get() as {
    count: number;
  };

  const first = handleGetTrialEquity(db, experiment, String(bestIndex));
  const second = handleGetTrialEquity(db, experiment, String(bestIndex));
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.body, first.body);

  const runsAfter = db.prepare("SELECT COUNT(*) AS count FROM backtest_runs").get() as {
    count: number;
  };
  assert.equal(Number(runsAfter.count), Number(runsBefore.count));
});

test("trial equity rejects unknown, invalid, and rejected trials", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);

  assert.equal(handleGetTrialEquity(db, experiment, "9999").statusCode, 404);
  assert.equal(handleGetTrialEquity(db, experiment, "abc").statusCode, 400);
  assert.equal(handleGetTrialEquity(db, experiment, "-1").statusCode, 400);

  const rejected = handleListExperimentTrials(
    db,
    experiment,
    new URLSearchParams("status=rejected&limit=1"),
  );
  const rejectedTrials = (rejected.body as { trials: OptimizationTrialRecord[] }).trials;
  assert.ok(rejectedTrials.length > 0, "expected the duplicate-heavy fixture to reject a trial");
  const response = handleGetTrialEquity(db, experiment, String(rejectedTrials[0].trial_index));
  assert.equal(response.statusCode, 400);
});

test("trial equity returns 409 when stored candles no longer match the snapshot", async () => {
  const db = makeDb();
  const experiment = await completedExperiment(db);
  const extra = candle(400, 100, 100);
  db.prepare(
    `INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume, vwap, transactions)
     VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "TEST",
    extra.timestamp_ms,
    extra.open,
    extra.high,
    extra.low,
    extra.close,
    extra.volume,
    extra.vwap,
    extra.transactions,
  );

  const response = handleGetTrialEquity(
    db,
    experiment,
    String(experiment.summary!.best_trial_index!),
  );
  assert.equal(response.statusCode, 409);
  assert.match((response.body as { detail: string }).detail, /no longer match/);
});
