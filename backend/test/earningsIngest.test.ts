import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import {
  monthsInRange,
  weekdayDatesInMonth,
} from "../src/services/earnings/earningsCalendar.ts";
import { ingestEarnings } from "../src/services/earnings/earningsIngest.ts";
import {
  announcementAvailabilityMs,
  parseEpsValue,
  parseFiscalPeriod,
} from "../src/services/earnings/earningsNormalize.ts";
import { getEvents } from "../src/services/eventStore.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/nasdaq_earnings", import.meta.url));
const dayMs = 86_400_000;
const fixtureDays = new Set(["2024-01-25", "2024-01-26"]);
const unreachableBaseUrl = "http://127.0.0.1:1";

function endOfDayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) + dayMs - 1;
}

/** Fixture files cover the meaningful days; every other weekday caches as empty. */
function makeCacheDir(): string {
  const cacheDir = mkdtempSync(join(tmpdir(), "earnings-ingest-test-"));
  const monthDir = join(cacheDir, "2024-01");
  mkdirSync(monthDir, { recursive: true });
  for (const dateIso of weekdayDatesInMonth({ year: 2024, month: 1 })) {
    if (fixtureDays.has(dateIso)) {
      cpSync(join(fixturesDir, "2024-01", `${dateIso}.json`), join(monthDir, `${dateIso}.json`));
    } else {
      writeFileSync(join(monthDir, `${dateIso}.json`), '{"data":null}');
    }
  }
  return cacheDir;
}

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insertCandle = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, 1, 1, 1, ?, 100)
  `);
  insertCandle.run("BEAT", Date.UTC(2024, 0, 25), 50);
  insertCandle.run("MISS", Date.UTC(2024, 0, 24), 10);
  insertCandle.run("MEET", Date.UTC(2024, 0, 25), 5);
  insertCandle.run("NOEST", Date.UTC(2024, 0, 25), 5);
  insertCandle.run("NOACT", Date.UTC(2024, 0, 25), 5);
  insertCandle.run("PREM", Date.UTC(2024, 0, 25), 20);
  insertCandle.run("LATE", Date.UTC(2024, 0, 31), 7);
  return db;
}

async function ingestFixtureMonth(db: Database, cacheDir: string) {
  return ingestEarnings({
    db,
    fromYear: 2024,
    toYear: 2024,
    cacheDir,
    baseUrl: unreachableBaseUrl,
    nowMs: Date.UTC(2024, 1, 15),
  });
}

test("fixture month normalizes to exact expected events", async () => {
  const db = makeDb();
  const summaries = await ingestFixtureMonth(db, makeCacheDir());

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.month, "2024-01");
  assert.equal(summary.status, "completed");
  assert.equal(summary.inserted, 4);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.unknown_ticker_rows, 1);
  assert.deepEqual(summary.unknown_tickers, ["ZZZZ"]);
  assert.deepEqual(summary.skips, {
    missing_symbol: 1,
    missing_actual: 1,
    missing_estimate: 1,
    zero_surprise: 1,
  });

  const events = getEvents(db).map(({ id, created_at, ...rest }) => rest);
  assert.deepEqual(events, [
    {
      source: "nasdaq_earnings",
      ticker: "BEAT",
      event_kind: "earnings_beat",
      event_ts_ms: endOfDayMs(2024, 0, 25),
      available_ts_ms: endOfDayMs(2024, 0, 25),
      score: Math.abs((0.85 - 0.75) / 50),
      payload: {
        eps_actual: 0.85,
        eps_estimate: 0.75,
        num_estimates: 12,
        standardized_surprise: (0.85 - 0.75) / 50,
        announce_time: "not-supplied",
        fiscal_period: "2023-12",
      },
      dedupe_key: "nasdaq_earnings:BEAT:2023-12",
    },
    {
      source: "nasdaq_earnings",
      ticker: "MISS",
      event_kind: "earnings_miss",
      event_ts_ms: endOfDayMs(2024, 0, 25),
      available_ts_ms: endOfDayMs(2024, 0, 25),
      score: Math.abs((-0.09 - -0.07) / 10),
      payload: {
        eps_actual: -0.09,
        eps_estimate: -0.07,
        num_estimates: null,
        standardized_surprise: (-0.09 - -0.07) / 10,
        announce_time: "after-hours",
        fiscal_period: "2023-12",
      },
      dedupe_key: "nasdaq_earnings:MISS:2023-12",
    },
    {
      source: "nasdaq_earnings",
      ticker: "LATE",
      event_kind: "earnings_beat",
      event_ts_ms: endOfDayMs(2024, 0, 25),
      available_ts_ms: endOfDayMs(2024, 0, 25),
      score: null,
      payload: {
        eps_actual: 0.2,
        eps_estimate: 0.1,
        num_estimates: 2,
        standardized_surprise: null,
        announce_time: "not-supplied",
        fiscal_period: "2023-12",
      },
      dedupe_key: "nasdaq_earnings:LATE:2023-12",
    },
    {
      source: "nasdaq_earnings",
      ticker: "PREM",
      event_kind: "earnings_beat",
      event_ts_ms: Date.UTC(2024, 0, 26) - 1,
      available_ts_ms: Date.UTC(2024, 0, 26) - 1,
      score: (2.0 - 1.5) / 20,
      payload: {
        eps_actual: 2.0,
        eps_estimate: 1.5,
        num_estimates: 5,
        standardized_surprise: (2.0 - 1.5) / 20,
        announce_time: "pre-market",
        fiscal_period: "2023-12",
      },
      dedupe_key: "nasdaq_earnings:PREM:2023-12",
    },
  ]);
});

test("ingestion is recorded and re-runs are skipped as already ingested", async () => {
  const db = makeDb();
  const cacheDir = makeCacheDir();
  await ingestFixtureMonth(db, cacheDir);

  const ingestion = db
    .prepare(`
      SELECT status, inserted_rows, skipped_rows, start_ms, end_ms
      FROM event_ingestions WHERE source = 'nasdaq_earnings'
    `)
    .get()!;
  assert.equal(String(ingestion.status), "completed");
  assert.equal(Number(ingestion.inserted_rows), 4);
  assert.equal(Number(ingestion.skipped_rows), 5);
  assert.equal(Number(ingestion.start_ms), Date.UTC(2024, 0, 1));
  assert.equal(Number(ingestion.end_ms), Date.UTC(2024, 1, 1) - 1);

  const rerun = await ingestFixtureMonth(db, cacheDir);
  assert.equal(rerun[0]!.status, "already_ingested");
  assert.equal(getEvents(db).length, 4);
});

test("a failed ingestion does not block a retry", async () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO event_ingestions (source, start_ms, end_ms, status, error)
    VALUES ('nasdaq_earnings', ?, ?, 'failed', 'boom')
  `).run(Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1) - 1);

  const summaries = await ingestFixtureMonth(db, makeCacheDir());
  assert.equal(summaries[0]!.status, "completed");
  assert.equal(getEvents(db).length, 4);
});

test("monthsInRange clamps to the first calendar year and ended months", () => {
  assert.deepEqual(monthsInRange(2006, 2008, Date.UTC(2008, 2, 10)), [
    { year: 2008, month: 1 },
    { year: 2008, month: 2 },
  ]);
  assert.deepEqual(monthsInRange(2024, 2024, Date.UTC(2024, 0, 20)), []);
});

test("weekdayDatesInMonth lists Mondays through Fridays only", () => {
  const dates = weekdayDatesInMonth({ year: 2024, month: 1 });
  assert.equal(dates.length, 23);
  assert.equal(dates[0], "2024-01-01");
  assert.equal(dates.at(-1), "2024-01-31");
  assert.ok(!dates.includes("2024-01-06"));
  assert.ok(!dates.includes("2024-01-07"));
});

test("parseEpsValue handles calendar formats", () => {
  assert.equal(parseEpsValue("$0.85"), 0.85);
  assert.equal(parseEpsValue("($0.09)"), -0.09);
  assert.equal(parseEpsValue("$1,234.50"), 1234.5);
  assert.equal(parseEpsValue(""), null);
  assert.equal(parseEpsValue("N/A"), null);
  assert.equal(parseEpsValue("garbage"), null);
});

test("parseFiscalPeriod normalizes Mon/YYYY", () => {
  assert.equal(parseFiscalPeriod("Sep/2024"), "2024-09");
  assert.equal(parseFiscalPeriod("dec/2023"), "2023-12");
  assert.equal(parseFiscalPeriod("2024-09"), null);
  assert.equal(parseFiscalPeriod(""), null);
});

test("announcementAvailabilityMs anchors pre-market before the day's bar", () => {
  const dayStart = Date.UTC(2024, 0, 26);
  assert.equal(announcementAvailabilityMs(dayStart, "pre-market"), dayStart - 1);
  assert.equal(announcementAvailabilityMs(dayStart, "after-hours"), dayStart + dayMs - 1);
  assert.equal(announcementAvailabilityMs(dayStart, "not-supplied"), dayStart + dayMs - 1);
});
