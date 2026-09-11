import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents } from "../src/services/eventStore.ts";
import { ingestShortInterest } from "../src/services/finra/shortInterestIngest.ts";
import { cycleBoundsMs } from "../src/services/finra/shortInterestNormalize.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/finra", import.meta.url));
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
  for (const ticker of ["AAA", "BBB", "CCC", "DDD"]) {
    insertCandle.run(ticker);
  }
  return db;
}

async function ingestFixtureCycle(db: Database, nowMs = Date.UTC(2024, 0, 26)) {
  return ingestShortInterest({
    db,
    fromYear: 2024,
    toYear: 2024,
    cacheDir: fixturesDir,
    baseUrl: "http://finra.invalid",
    nowMs,
  });
}

test("fixture cycle normalizes to exact expected events", async () => {
  const db = makeDb();
  const summaries = await ingestFixtureCycle(db);

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.cycle, "2024-01-mid");
  assert.equal(summary.status, "completed");
  assert.equal(summary.settlement_date, "2024-01-12");
  assert.equal(summary.inserted, 5);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.unknown_ticker_rows, 1);
  assert.deepEqual(summary.unknown_tickers, ["ZZZZ"]);
  assert.deepEqual(summary.skips, {
    missing_symbol: 1,
    invalid_settlement_date: 1,
    invalid_short_interest: 1,
  });

  const events = getEvents(db).map(({ id, created_at, ...rest }) => rest);
  const eventTsMs = endOfDayMs(2024, 0, 12);
  const availableTsMs = endOfDayMs(2024, 0, 24);
  assert.deepEqual(events, [
    {
      source: "finra_short_interest",
      ticker: "AAA",
      event_kind: "short_interest_report",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: 2.12,
      payload: {
        settlement_date: "2024-01-12",
        short_interest: 5_331_733,
        previous_short_interest: 5_662_129,
        change_percent: -5.84,
        average_daily_volume: 2_510_868,
        days_to_cover: 2.12,
        market_class: "NYSE",
      },
      dedupe_key: "finra_si:report:AAA:2024-01-12",
    },
    {
      source: "finra_short_interest",
      ticker: "BBB",
      event_kind: "short_interest_report",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: 6,
      payload: {
        settlement_date: "2024-01-12",
        short_interest: 3_000_000,
        previous_short_interest: 1_500_000,
        change_percent: 100,
        average_daily_volume: 500_000,
        days_to_cover: 6,
        market_class: "NNM",
      },
      dedupe_key: "finra_si:report:BBB:2024-01-12",
    },
    {
      source: "finra_short_interest",
      ticker: "BBB",
      event_kind: "short_interest_spike",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: 100,
      payload: {
        settlement_date: "2024-01-12",
        short_interest: 3_000_000,
        previous_short_interest: 1_500_000,
        change_percent: 100,
        average_daily_volume: 500_000,
        days_to_cover: 6,
        market_class: "NNM",
      },
      dedupe_key: "finra_si:spike:BBB:2024-01-12",
    },
    {
      source: "finra_short_interest",
      ticker: "CCC",
      event_kind: "short_interest_report",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: 1,
      payload: {
        settlement_date: "2024-01-12",
        short_interest: 900_000,
        previous_short_interest: 500_000,
        change_percent: 80,
        average_daily_volume: 900_000,
        days_to_cover: 1,
        market_class: "ARCA",
      },
      dedupe_key: "finra_si:report:CCC:2024-01-12",
    },
    {
      source: "finra_short_interest",
      ticker: "DDD",
      event_kind: "short_interest_report",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: 5,
      payload: {
        settlement_date: "2024-01-12",
        short_interest: 250_000,
        previous_short_interest: 0,
        change_percent: 100,
        average_daily_volume: 50_000,
        days_to_cover: 5,
        market_class: "NYSE",
      },
      dedupe_key: "finra_si:report:DDD:2024-01-12",
    },
  ]);
});

test("ingestion is recorded and re-runs are skipped as already ingested", async () => {
  const db = makeDb();
  await ingestFixtureCycle(db);

  const ingestion = db
    .prepare("SELECT status, inserted_rows, skipped_rows, start_ms, end_ms FROM event_ingestions")
    .get()!;
  assert.equal(String(ingestion.status), "completed");
  assert.equal(Number(ingestion.inserted_rows), 5);
  assert.equal(Number(ingestion.skipped_rows), 4);
  assert.equal(Number(ingestion.start_ms), Date.UTC(2024, 0, 1));
  assert.equal(Number(ingestion.end_ms), endOfDayMs(2024, 0, 15));

  const rerun = await ingestFixtureCycle(db);
  assert.equal(rerun[0]!.status, "already_ingested");
  assert.equal(getEvents(db).length, 5);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS n FROM event_ingestions").get()!.n),
    1,
  );
});

test("a cycle inside the publication lag is reported unpublished without touching the network", async () => {
  const db = makeDb();
  const summaries = await ingestFixtureCycle(db, Date.UTC(2024, 0, 20));
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.status, "unpublished");
  assert.equal(getEvents(db).length, 0);
});

test("a failed ingestion does not block a retry", async () => {
  const db = makeDb();
  const { startMs, endMs } = cycleBoundsMs({ year: 2024, month: 1, half: "mid" });
  db.prepare(`
    INSERT INTO event_ingestions (source, start_ms, end_ms, status, error)
    VALUES ('finra_short_interest', ?, ?, 'failed', 'boom')
  `).run(startMs, endMs);

  const summaries = await ingestFixtureCycle(db);
  assert.equal(summaries[0]!.status, "completed");
  assert.equal(getEvents(db).length, 5);
});
