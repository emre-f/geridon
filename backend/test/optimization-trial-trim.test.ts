import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleGetExperimentTrial,
  handleListExperimentTrials,
} from "../src/api/optimizationTrials.ts";
import { trialMetrics } from "../src/services/optimization/experimentRows.ts";
import { fullDetailRankLimit } from "../src/services/optimization/trialStore.ts";
import type {
  OptimizationExperimentRecord,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "../src/types.ts";
import { candle } from "./optimizationFixtures.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";
import type { Database } from "../src/db.ts";

async function wideExperiment(db: Database): Promise<OptimizationExperimentRecord> {
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);
  const experiment = await runToCompletion(
    db,
    runner,
    experimentBody(strategyId, {
      max_trials: 30,
      halving: { promotionRate: 1 },
      parameter_overrides: {
        "entry.right.value": { min: 90, max: 96, step: 0.01 },
        "exit.right.value": { min: 104, max: 110, step: 0.01 },
      },
    }),
  );
  assert.equal(experiment.status, "completed");
  assert.ok(
    experiment.summary!.trial_counts.scored > fullDetailRankLimit,
    "fixture must score more trials than the full-detail limit",
  );
  return experiment;
}

interface TrimRow {
  trial_index: number;
  status: string;
  rank: number | null;
  trimmed: number;
  has_metrics: number;
}

function trialRows(db: Database, experimentId: number): TrimRow[] {
  return db
    .prepare(
      `SELECT trial_index, status, leaderboard_rank AS rank,
              fold_results IS NULL AS trimmed, metrics IS NOT NULL AS has_metrics
       FROM optimization_trials WHERE experiment_id = ?`,
    )
    .all(experimentId) as unknown as TrimRow[];
}

test("per-fold detail is kept for top ranks and dropped for the rest", async () => {
  const db = makeDb();
  const experiment = await wideExperiment(db);
  const rows = trialRows(db, experiment.id);

  for (const row of rows.filter((candidate) => candidate.status === "scored")) {
    assert.equal(row.has_metrics, 1, `scored trial ${row.trial_index} must keep metrics`);
    assert.ok(row.rank != null);
    if (row.rank! <= fullDetailRankLimit) {
      assert.equal(row.trimmed, 0, `rank ${row.rank} must keep fold results`);
    } else {
      assert.equal(row.trimmed, 1, `rank ${row.rank} must drop fold results`);
    }
  }

  const listed = handleListExperimentTrials(
    db,
    experiment,
    new URLSearchParams("status=scored&limit=500"),
  );
  const trials = (listed.body as { trials: OptimizationTrialRecord[] }).trials;
  for (const trial of trials) {
    assert.ok(trial.metrics, `leaderboard metrics missing for trial ${trial.trial_index}`);
    assert.ok(trial.metrics!.fold_count > 0);
  }
});

test("a trimmed trial recomputes fold results on demand, deterministically", async () => {
  const db = makeDb();
  const experiment = await wideExperiment(db);
  const trimmed = trialRows(db, experiment.id).find(
    (row) => row.status === "scored" && row.trimmed === 1,
  )!;

  const first = handleGetExperimentTrial(db, experiment, String(trimmed.trial_index));
  assert.equal(first.statusCode, 200);
  const detail = first.body as OptimizationTrialDetail;
  assert.equal(detail.fold_results.length, experiment.config.folds.foldCount);

  const second = handleGetExperimentTrial(db, experiment, String(trimmed.trial_index));
  assert.deepEqual(second.body, first.body);

  assert.deepEqual(trialMetrics(detail.fold_results), detail.metrics);

  const stillTrimmed = trialRows(db, experiment.id).find(
    (row) => row.trial_index === trimmed.trial_index,
  )!;
  assert.equal(stillTrimmed.trimmed, 1, "recompute must not persist fold results");
});

test("recomputing a trimmed trial returns 409 when stored candles drifted", async () => {
  const db = makeDb();
  const experiment = await wideExperiment(db);
  const rows = trialRows(db, experiment.id);
  const trimmed = rows.find((row) => row.status === "scored" && row.trimmed === 1)!;
  const kept = rows.find((row) => row.status === "scored" && row.rank === 1)!;

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

  const recompute = handleGetExperimentTrial(db, experiment, String(trimmed.trial_index));
  assert.equal(recompute.statusCode, 409);
  assert.match((recompute.body as { detail: string }).detail, /no longer match/);

  const stored = handleGetExperimentTrial(db, experiment, String(kept.trial_index));
  assert.equal(stored.statusCode, 200);
  assert.ok((stored.body as OptimizationTrialDetail).fold_results.length > 0);
});
