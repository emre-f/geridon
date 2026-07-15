import assert from "node:assert/strict";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { loadExperimentDatasets } from "../src/api/optimizationRequests.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import { ExperimentRunner } from "../src/services/optimization/experimentRunner.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import type { OptimizationExperimentRecord } from "../src/types.ts";
import { thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

export function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

export function makeRunner(db: Database): ExperimentRunner {
  return new ExperimentRunner(db, (config) => loadExperimentDatasets(db, config));
}

export function insertCandles(db: Database, ticker: string, count: number) {
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

export function insertStrategy(db: Database): number {
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  return Number(inserted.lastInsertRowid);
}

export function experimentBody(strategyId: number, overrides?: Record<string, unknown>) {
  return {
    strategy_id: strategyId,
    tickers: ["TEST"],
    timeframe: "1d",
    start_ms: 0,
    end_ms: 4e12,
    seed: 42,
    max_trials: 12,
    worker_count: 1,
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

export async function runToCompletion(
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
