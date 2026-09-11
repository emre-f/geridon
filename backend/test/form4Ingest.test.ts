import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents } from "../src/services/eventStore.ts";
import {
  ingestForm4,
  quarterBoundsMs,
  quartersInRange,
} from "../src/services/sec/form4Ingest.ts";
import { OFFICER_SCORE_BONUS } from "../src/services/sec/form4Normalize.ts";
import { parseSecDateMs } from "../src/services/sec/secTsv.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/sec", import.meta.url));
const dayMs = 86_400_000;

function endOfDayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) + dayMs - 1;
}

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insertCandle = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', 0, 1, 1, 1, 1, 100)
  `);
  for (const ticker of ["FMBH", "TOL"]) {
    insertCandle.run(ticker);
  }
  return db;
}

async function ingestFixtureQuarter(db: Database) {
  return ingestForm4({
    db,
    fromYear: 2024,
    toYear: 2024,
    userAgent: "geridon test",
    cacheDir: fixturesDir,
    nowMs: Date.UTC(2024, 3, 15),
  });
}

test("fixture quarter normalizes to exact expected events", async () => {
  const db = makeDb();
  const summaries = await ingestFixtureQuarter(db);

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.quarter, "2024q1");
  assert.equal(summary.status, "completed");
  assert.equal(summary.inserted, 5);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.unknown_ticker_rows, 1);
  assert.deepEqual(summary.unknown_tickers, ["ZZZZ"]);
  assert.deepEqual(summary.skips, {
    non_open_market: 1,
    missing_submission: 1,
    missing_owner: 1,
    missing_ticker: 1,
    invalid_dates: 0,
    invalid_shares: 0,
    point_in_time_violations: 1,
  });

  const events = getEvents(db).map(({ id, created_at, ...rest }) => rest);
  assert.deepEqual(events, [
    {
      source: "sec_form4",
      ticker: "FMBH",
      event_kind: "insider_buy",
      event_ts_ms: Date.UTC(2024, 0, 27),
      available_ts_ms: endOfDayMs(2024, 0, 30),
      score: Math.log10(2_000 * 49),
      payload: {
        insider_name: "Quill Sam",
        is_officer: false,
        is_director: true,
        is_ten_percent_owner: false,
        shares: 2_000,
        price: 49,
        dollar_value: 2_000 * 49,
      },
      dedupe_key: "sec_form4:0000700565:0005678901:2024-01-27:P:2000:49",
    },
    {
      source: "sec_form4",
      ticker: "FMBH",
      event_kind: "insider_buy",
      event_ts_ms: Date.UTC(2024, 0, 29),
      available_ts_ms: endOfDayMs(2024, 0, 31),
      score: Math.log10(50_000) + OFFICER_SCORE_BONUS,
      payload: {
        insider_name: "Roe Jane",
        is_officer: true,
        is_director: false,
        is_ten_percent_owner: false,
        shares: 1_000,
        price: 50,
        dollar_value: 50_000,
      },
      dedupe_key: "sec_form4:0000700565:0001234567:2024-01-29:P:1000:50",
    },
    {
      source: "sec_form4",
      ticker: "FMBH",
      event_kind: "insider_buy",
      event_ts_ms: Date.UTC(2024, 0, 24),
      available_ts_ms: endOfDayMs(2024, 0, 31),
      score: null,
      payload: {
        insider_name: "Roe Jane",
        is_officer: true,
        is_director: false,
        is_ten_percent_owner: false,
        shares: 500,
        price: null,
        dollar_value: null,
      },
      dedupe_key: "sec_form4:0000700565:0001234567:2024-01-24:P:500:",
    },
    {
      source: "sec_form4",
      ticker: "TOL",
      event_kind: "insider_sell",
      event_ts_ms: Date.UTC(2024, 0, 30),
      available_ts_ms: endOfDayMs(2024, 0, 31),
      score: Math.log10(200 * 21.97) + OFFICER_SCORE_BONUS,
      payload: {
        insider_name: "Doe John; Smith Ann",
        is_officer: true,
        is_director: true,
        is_ten_percent_owner: false,
        shares: 200,
        price: 21.97,
        dollar_value: 200 * 21.97,
      },
      dedupe_key: "sec_form4:0000794170:0001357913+0002345678:2024-01-30:S:200:21.97",
    },
    {
      source: "sec_form4",
      ticker: "FMBH",
      event_kind: "insider_buy",
      event_ts_ms: Date.UTC(2024, 0, 26),
      available_ts_ms: endOfDayMs(2024, 0, 31),
      score: Math.log10(300 * 47),
      payload: {
        insider_name: "Poe Edgar",
        is_officer: false,
        is_director: false,
        is_ten_percent_owner: true,
        shares: 300,
        price: 47,
        dollar_value: 300 * 47,
      },
      dedupe_key: "sec_form4:0000700565:0003456789:2024-01-26:P:300:47",
    },
  ]);
});

test("ingestion is recorded and re-runs are skipped as already ingested", async () => {
  const db = makeDb();
  await ingestFixtureQuarter(db);

  const ingestion = db
    .prepare("SELECT status, inserted_rows, skipped_rows, start_ms, end_ms FROM event_ingestions")
    .get()!;
  assert.equal(String(ingestion.status), "completed");
  assert.equal(Number(ingestion.inserted_rows), 5);
  assert.equal(Number(ingestion.skipped_rows), 5);
  assert.equal(Number(ingestion.start_ms), Date.UTC(2024, 0, 1));
  assert.equal(Number(ingestion.end_ms), Date.UTC(2024, 3, 1) - 1);

  const rerun = await ingestFixtureQuarter(db);
  assert.equal(rerun[0]!.status, "already_ingested");
  assert.equal(getEvents(db).length, 5);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS n FROM event_ingestions").get()!.n),
    1,
  );
});

test("a failed ingestion does not block a retry", async () => {
  const db = makeDb();
  const { startMs, endMs } = quarterBoundsMs({ year: 2024, quarter: 1 });
  db.prepare(`
    INSERT INTO event_ingestions (source, start_ms, end_ms, status, error)
    VALUES ('sec_form4', ?, ?, 'failed', 'boom')
  `).run(startMs, endMs);

  const summaries = await ingestFixtureQuarter(db);
  assert.equal(summaries[0]!.status, "completed");
  assert.equal(getEvents(db).length, 5);
});

test("quartersInRange stops at the last fully ended quarter", () => {
  assert.deepEqual(quartersInRange(2023, 2024, Date.UTC(2024, 7, 15)), [
    { year: 2023, quarter: 1 },
    { year: 2023, quarter: 2 },
    { year: 2023, quarter: 3 },
    { year: 2023, quarter: 4 },
    { year: 2024, quarter: 1 },
    { year: 2024, quarter: 2 },
  ]);
  assert.deepEqual(quartersInRange(2024, 2024, Date.UTC(2024, 0, 15)), []);
});

test("parseSecDateMs handles DERA date strings", () => {
  assert.equal(parseSecDateMs("31-JAN-2024"), Date.UTC(2024, 0, 31));
  assert.equal(parseSecDateMs("1-jul-2006"), Date.UTC(2006, 6, 1));
  assert.equal(parseSecDateMs("31-FEB-2024"), null);
  assert.equal(parseSecDateMs("2024-01-31"), null);
  assert.equal(parseSecDateMs(""), null);
});
