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
  `);
}
