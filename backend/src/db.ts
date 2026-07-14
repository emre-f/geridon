import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { backendRoot } from "./config.ts";

export type Database = InstanceType<typeof DatabaseSync>;

export function databasePathFromUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("sqlite:///")) {
    throw new Error("Only sqlite:/// database URLs are supported.");
  }

  const rawPath = databaseUrl.slice("sqlite:///".length);
  if (rawPath === ":memory:") {
    return rawPath;
  }
  return isAbsolute(rawPath) ? rawPath : resolve(backendRoot, rawPath);
}

export function openDatabase(databaseUrl: string): Database {
  const dbPath = databasePathFromUrl(databaseUrl);
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export function createDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY,
      ticker VARCHAR(16) NOT NULL,
      multiplier INTEGER NOT NULL,
      timespan VARCHAR(16) NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      open FLOAT NOT NULL,
      high FLOAT NOT NULL,
      low FLOAT NOT NULL,
      close FLOAT NOT NULL,
      volume FLOAT NOT NULL,
      vwap FLOAT,
      transactions INTEGER,
      source VARCHAR(32) NOT NULL DEFAULT 'polygon',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_candle_identity UNIQUE (ticker, multiplier, timespan, timestamp_ms)
    );

    CREATE INDEX IF NOT EXISTS ix_candles_ticker ON candles (ticker);
    CREATE INDEX IF NOT EXISTS ix_candles_timestamp_ms ON candles (timestamp_ms);
    CREATE INDEX IF NOT EXISTS ix_candles_lookup
      ON candles (ticker, multiplier, timespan, timestamp_ms);

    CREATE TABLE IF NOT EXISTS fetch_ranges (
      id INTEGER PRIMARY KEY,
      ticker VARCHAR(16) NOT NULL,
      multiplier INTEGER NOT NULL,
      timespan VARCHAR(16) NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'polygon',
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS ix_fetch_ranges_ticker ON fetch_ranges (ticker);
    CREATE INDEX IF NOT EXISTS ix_fetch_ranges_lookup
      ON fetch_ranges (ticker, multiplier, timespan, start_ms, end_ms);
    CREATE INDEX IF NOT EXISTS ix_fetch_ranges_source_lookup
      ON fetch_ranges (ticker, multiplier, timespan, source, start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      definition TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chart_states (
      ticker VARCHAR(16) PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id INTEGER PRIMARY KEY,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      ticker VARCHAR(16) NOT NULL,
      timeframe VARCHAR(8) NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      position_mode VARCHAR(16) NOT NULL DEFAULT 'long_only',
      buy_percent FLOAT NOT NULL,
      sell_percent FLOAT NOT NULL,
      initial_capital FLOAT NOT NULL,
      costs TEXT,
      strategy_snapshot TEXT NOT NULL,
      metrics TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS ix_backtest_runs_strategy
      ON backtest_runs (strategy_id, created_at);

    CREATE TABLE IF NOT EXISTS optimization_experiments (
      id INTEGER PRIMARY KEY,
      strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      config TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      progress TEXT,
      summary TEXT,
      holdout TEXT,
      error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS ix_optimization_experiments_status
      ON optimization_experiments (status, created_at);

    CREATE TABLE IF NOT EXISTS optimization_trials (
      id INTEGER PRIMARY KEY,
      experiment_id INTEGER NOT NULL
        REFERENCES optimization_experiments(id) ON DELETE CASCADE,
      trial_index INTEGER NOT NULL,
      hash VARCHAR(64) NOT NULL,
      phase VARCHAR(8) NOT NULL,
      status VARCHAR(16) NOT NULL,
      rejection_reason TEXT,
      stage_reached INTEGER NOT NULL,
      leaderboard_rank INTEGER,
      eligible INTEGER,
      score FLOAT,
      score_detail TEXT,
      trial_values TEXT NOT NULL,
      strategy TEXT,
      complexity TEXT NOT NULL,
      fold_results TEXT,
      metrics TEXT,
      CONSTRAINT uq_optimization_trial UNIQUE (experiment_id, trial_index)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_optimization_trials_hash
      ON optimization_trials (experiment_id, hash) WHERE status != 'rejected';
    CREATE INDEX IF NOT EXISTS ix_optimization_trials_rank
      ON optimization_trials (experiment_id, leaderboard_rank);
    CREATE INDEX IF NOT EXISTS ix_optimization_trials_status
      ON optimization_trials (experiment_id, status);
  `);

  // Databases created before a column existed need it added in place.
  const backtestColumns = db
    .prepare("SELECT name FROM pragma_table_info('backtest_runs')")
    .all()
    .map((row) => String(row.name));
  if (!backtestColumns.includes("position_mode")) {
    db.exec(
      "ALTER TABLE backtest_runs ADD COLUMN position_mode VARCHAR(16) NOT NULL DEFAULT 'long_only'",
    );
  }
  if (!backtestColumns.includes("costs")) {
    db.exec("ALTER TABLE backtest_runs ADD COLUMN costs TEXT");
  }

  const experimentColumns = db
    .prepare("SELECT name FROM pragma_table_info('optimization_experiments')")
    .all()
    .map((row) => String(row.name));
  if (!experimentColumns.includes("holdout")) {
    db.exec("ALTER TABLE optimization_experiments ADD COLUMN holdout TEXT");
  }

  const trialColumns = db
    .prepare("SELECT name FROM pragma_table_info('optimization_trials')")
    .all()
    .map((row) => String(row.name));
  if (!trialColumns.includes("metrics")) {
    db.exec("ALTER TABLE optimization_trials ADD COLUMN metrics TEXT");
  }
}
