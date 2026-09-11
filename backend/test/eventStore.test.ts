import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import {
  getEventCoverage,
  getEvents,
  getKnownTickers,
  insertEvents,
} from "../src/services/eventStore.ts";
import type { EventRecord, InsiderTransactionPayload } from "../src/types/events.ts";

const dayMs = 86_400_000;

function makeDb(tickers: string[] = ["AAPL", "MSFT"]): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insertCandle = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', 0, 1, 1, 1, 1, 100)
  `);
  for (const ticker of tickers) {
    insertCandle.run(ticker);
  }
  return db;
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    source: "sec_form4",
    ticker: "AAPL",
    event_kind: "insider_buy",
    event_ts_ms: Date.UTC(2020, 0, 6),
    available_ts_ms: Date.UTC(2020, 0, 8),
    score: 5.2,
    payload: {
      insider_name: "Jane Roe",
      is_officer: true,
      is_director: false,
      is_ten_percent_owner: false,
      shares: 1_000,
      price: 50,
      dollar_value: 50_000,
    },
    dedupe_key: "acc-1:row-1",
    ...overrides,
  };
}

test("insertEvents writes batches and re-ingestion is idempotent", () => {
  const db = makeDb();
  const batch = [
    makeEvent(),
    makeEvent({ ticker: "MSFT", dedupe_key: "acc-2:row-1" }),
  ];

  const first = insertEvents(db, batch);
  assert.equal(first.inserted, 2);
  assert.equal(first.duplicates, 0);

  const second = insertEvents(db, batch);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 2);

  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get();
  assert.equal(Number(count!.n), 2);
});

test("insertEvents rejects the whole batch on a point-in-time violation", () => {
  const db = makeDb();
  const batch = [
    makeEvent(),
    makeEvent({
      dedupe_key: "acc-3:row-1",
      event_ts_ms: Date.UTC(2020, 0, 8),
      available_ts_ms: Date.UTC(2020, 0, 6),
    }),
  ];

  assert.throws(() => insertEvents(db, batch), /Point-in-time violation.*acc-3:row-1/);

  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get();
  assert.equal(Number(count!.n), 0);
});

test("tickers are normalized to the candles table's symbols", () => {
  const db = makeDb();
  const summary = insertEvents(db, [makeEvent({ ticker: " aapl " })]);
  assert.equal(summary.inserted, 1);
  assert.equal(getEvents(db)[0]!.ticker, "AAPL");
});

test("unknown tickers are counted and reported, not silently dropped", () => {
  const db = makeDb();
  const summary = insertEvents(db, [
    makeEvent(),
    makeEvent({ ticker: "ZZZZ", dedupe_key: "acc-4:row-1" }),
    makeEvent({ ticker: "zzzz", dedupe_key: "acc-4:row-2" }),
    makeEvent({ ticker: "YYYY", dedupe_key: "acc-5:row-1" }),
  ]);

  assert.equal(summary.inserted, 1);
  assert.equal(summary.unknown_ticker_rows, 3);
  assert.deepEqual(summary.unknown_tickers, ["YYYY", "ZZZZ"]);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM events").get()!.n), 1);
});

test("getKnownTickers reflects the candles table", () => {
  const db = makeDb(["AAPL"]);
  assert.deepEqual([...getKnownTickers(db)], ["AAPL"]);
});

test("getEvents filters by kind, ticker, and available_ts window", () => {
  const db = makeDb();
  const base = Date.UTC(2020, 0, 6);
  insertEvents(db, [
    makeEvent({ dedupe_key: "a", available_ts_ms: base + dayMs }),
    makeEvent({ dedupe_key: "b", ticker: "MSFT", available_ts_ms: base + 2 * dayMs }),
    makeEvent({
      dedupe_key: "c",
      event_kind: "insider_sell",
      available_ts_ms: base + 3 * dayMs,
    }),
    makeEvent({ dedupe_key: "d", available_ts_ms: base + 10 * dayMs }),
  ]);

  const buys = getEvents(db, { kind: "insider_buy" });
  assert.deepEqual(buys.map((event) => event.dedupe_key), ["a", "b", "d"]);

  const msft = getEvents(db, { ticker: "msft" });
  assert.deepEqual(msft.map((event) => event.dedupe_key), ["b"]);

  const windowed = getEvents(db, {
    kinds: ["insider_buy", "insider_sell"],
    startMs: base + 2 * dayMs,
    endMs: base + 3 * dayMs,
  });
  assert.deepEqual(windowed.map((event) => event.dedupe_key), ["b", "c"]);

  const payload = buys[0]!.payload as InsiderTransactionPayload;
  assert.equal(payload.insider_name, "Jane Roe");
  assert.equal(buys[0]!.score, 5.2);
});

test("getEventCoverage counts events per kind per year of availability", () => {
  const db = makeDb();
  insertEvents(db, [
    makeEvent({ dedupe_key: "a", available_ts_ms: Date.UTC(2020, 5, 1) }),
    makeEvent({ dedupe_key: "b", available_ts_ms: Date.UTC(2020, 11, 31) }),
    makeEvent({ dedupe_key: "c", available_ts_ms: Date.UTC(2021, 0, 2) }),
    makeEvent({
      dedupe_key: "d",
      event_kind: "insider_sell",
      event_ts_ms: Date.UTC(2020, 11, 30),
      available_ts_ms: Date.UTC(2021, 0, 2),
    }),
  ]);

  assert.deepEqual(getEventCoverage(db), [
    { event_kind: "insider_buy", year: 2020, events: 2 },
    { event_kind: "insider_buy", year: 2021, events: 1 },
    { event_kind: "insider_sell", year: 2021, events: 1 },
  ]);
});
