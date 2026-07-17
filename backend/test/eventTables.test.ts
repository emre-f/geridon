import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

function insertEvent(
  db: Database,
  overrides: Partial<{
    source: string;
    ticker: string;
    event_kind: string;
    event_ts_ms: number;
    available_ts_ms: number;
    dedupe_key: string;
  }> = {},
): void {
  const row = {
    source: "sec_form4",
    ticker: "AAPL",
    event_kind: "insider_buy",
    event_ts_ms: 1_000,
    available_ts_ms: 2_000,
    dedupe_key: "acc-1:row-1",
    ...overrides,
  };
  db.prepare(`
    INSERT INTO events (source, ticker, event_kind, event_ts_ms, available_ts_ms, score, payload, dedupe_key)
    VALUES (?, ?, ?, ?, ?, NULL, '{}', ?)
  `).run(
    row.source,
    row.ticker,
    row.event_kind,
    row.event_ts_ms,
    row.available_ts_ms,
    row.dedupe_key,
  );
}

test("createDb is idempotent with the events tables present", () => {
  const db = makeDb();
  createDb(db);
  insertEvent(db);
});

test("dedupe_key is unique and insert-or-ignore makes re-ingestion idempotent", () => {
  const db = makeDb();
  insertEvent(db);
  assert.throws(() => insertEvent(db), /UNIQUE/);

  db.prepare(`
    INSERT OR IGNORE INTO events
      (source, ticker, event_kind, event_ts_ms, available_ts_ms, score, payload, dedupe_key)
    VALUES ('sec_form4', 'AAPL', 'insider_buy', 1000, 2000, NULL, '{}', 'acc-1:row-1')
  `).run();

  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get();
  assert.equal(Number(count!.n), 1);
});

test("events with available_ts_ms before event_ts_ms are rejected at the door", () => {
  const db = makeDb();
  assert.throws(
    () => insertEvent(db, { event_ts_ms: 2_000, available_ts_ms: 1_000 }),
    /ck_event_point_in_time|CHECK/,
  );
  insertEvent(db, { event_ts_ms: 2_000, available_ts_ms: 2_000, dedupe_key: "acc-2:row-1" });
});

test("event_ingestions records default to a running status with zero counts", () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO event_ingestions (source, start_ms, end_ms)
    VALUES ('sec_form4', 0, 1000)
  `).run();

  const row = db
    .prepare(
      "SELECT status, inserted_rows, skipped_rows, error, finished_at FROM event_ingestions",
    )
    .get();
  assert.ok(row);
  assert.equal(row.status, "running");
  assert.equal(Number(row.inserted_rows), 0);
  assert.equal(Number(row.skipped_rows), 0);
  assert.equal(row.error, null);
  assert.equal(row.finished_at, null);
});

test("query-shaped indexes exist for kind and ticker lookups", () => {
  const db = makeDb();
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'")
    .all()
    .map((row) => String(row.name));
  assert.ok(indexes.includes("ix_events_kind_available"));
  assert.ok(indexes.includes("ix_events_ticker_available"));
});
