import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { insertEvents } from "../src/services/eventStore.ts";
import {
  selectEvents,
  signalHoldoutStartMs,
} from "../src/services/signalEval/eventSelection.ts";
import type { EventRecord } from "../src/types/events.ts";

const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2020, 0, 1);

const barMs = (index: number, startMs = firstBarMs) => startMs + index * dayMs;

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

function insertDailyBars(
  db: Database,
  ticker: string,
  count: number,
  options: { close?: number; volume?: number; startMs?: number } = {},
): void {
  const close = options.close ?? 10;
  const volume = options.volume ?? 1_000_000;
  const insert = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < count; index += 1) {
    insert.run(ticker, barMs(index, options.startMs), close, close, close, close, volume);
  }
}

function makeBuy(overrides: Partial<EventRecord<"insider_buy">> = {}): EventRecord<"insider_buy"> {
  return {
    source: "sec_form4",
    ticker: "AAA",
    event_kind: "insider_buy",
    event_ts_ms: barMs(48),
    available_ts_ms: barMs(50) + 1_000,
    score: 5,
    payload: {
      insider_name: "Jane Roe",
      is_officer: true,
      is_director: false,
      is_ten_percent_owner: false,
      shares: 1_000,
      price: 50,
      dollar_value: 50_000,
    },
    dedupe_key: `key-${Math.random()}`,
    ...overrides,
  };
}

test("selects events and maps anchor and actionable bars", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 100);
  insertEvents(db, [makeBuy({ dedupe_key: "k1" })]);

  const result = selectEvents(db, { kind: "insider_buy" });
  assert.equal(result.stats.candidates, 1);
  assert.equal(result.stats.selected, 1);
  assert.equal(result.stats.tickers, 1);
  assert.equal(result.events[0].anchor_timestamp_ms, barMs(50));
  assert.equal(result.events[0].actionable_timestamp_ms, barMs(51));
});

test("clamps the range to pre-holdout unless includeHoldout", () => {
  const db = makeDb();
  const startMs = Date.UTC(2024, 11, 1);
  insertDailyBars(db, "AAA", 100, { startMs });
  insertEvents(db, [
    makeBuy({
      dedupe_key: "pre",
      event_ts_ms: Date.UTC(2024, 11, 10),
      available_ts_ms: Date.UTC(2024, 11, 15),
    }),
    makeBuy({
      dedupe_key: "post",
      event_ts_ms: Date.UTC(2025, 0, 8),
      available_ts_ms: Date.UTC(2025, 0, 10),
    }),
  ]);

  const clamped = selectEvents(db, { kind: "insider_buy" });
  assert.equal(clamped.stats.holdout_clamped, true);
  assert.equal(clamped.stats.candidates, 1);
  assert.equal(clamped.events[0].event.dedupe_key, "pre");

  const unclamped = selectEvents(db, { kind: "insider_buy", includeHoldout: true });
  assert.equal(unclamped.stats.holdout_clamped, false);
  assert.equal(unclamped.stats.candidates, 2);

  const explicitPreHoldout = selectEvents(db, {
    kind: "insider_buy",
    endMs: signalHoldoutStartMs - 1,
  });
  assert.equal(explicitPreHoldout.stats.holdout_clamped, false);
  assert.equal(explicitPreHoldout.stats.candidates, 1);
});

test("minScore excludes low and null scores", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 100);
  insertEvents(db, [
    makeBuy({ dedupe_key: "high", score: 5 }),
    makeBuy({ dedupe_key: "low", score: 2 }),
    makeBuy({ dedupe_key: "null", score: null }),
  ]);

  const result = selectEvents(db, { kind: "insider_buy", minScore: 4 });
  assert.equal(result.stats.selected, 1);
  assert.equal(result.stats.excluded.min_score, 2);
  assert.equal(result.events[0].event.dedupe_key, "high");
});

test("payload filters cover boolean flags, numeric minimums, and missing fields", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 100);
  const payload = makeBuy().payload;
  insertEvents(db, [
    makeBuy({ dedupe_key: "officer-big", payload: { ...payload, dollar_value: 200_000 } }),
    makeBuy({
      dedupe_key: "outsider-big",
      payload: { ...payload, is_officer: false, dollar_value: 200_000 },
    }),
    makeBuy({ dedupe_key: "officer-small", payload: { ...payload, dollar_value: 50_000 } }),
  ]);

  const result = selectEvents(db, {
    kind: "insider_buy",
    payloadFilters: { is_officer: 1, dollar_value: 100_000 },
  });
  assert.equal(result.stats.selected, 1);
  assert.equal(result.stats.excluded.payload_filters, 2);
  assert.equal(result.events[0].event.dedupe_key, "officer-big");

  const missingField = selectEvents(db, {
    kind: "insider_buy",
    payloadFilters: { insider_count: 1 },
  });
  assert.equal(missingField.stats.selected, 0);
  assert.equal(missingField.stats.excluded.payload_filters, 3);
});

test("universe filters exclude penny and illiquid tickers", () => {
  const db = makeDb();
  insertDailyBars(db, "CHEAP", 100, { close: 2, volume: 1_000_000 });
  insertDailyBars(db, "THIN", 100, { close: 20, volume: 1_000 });
  insertDailyBars(db, "GOOD", 100, { close: 20, volume: 1_000_000 });
  insertEvents(db, [
    makeBuy({ ticker: "CHEAP", dedupe_key: "cheap" }),
    makeBuy({ ticker: "THIN", dedupe_key: "thin" }),
    makeBuy({ ticker: "GOOD", dedupe_key: "good" }),
  ]);

  const result = selectEvents(db, {
    kind: "insider_buy",
    universe: { minPrice: 5, minMedianDollarVolume: 5_000_000 },
  });
  assert.equal(result.stats.selected, 1);
  assert.equal(result.stats.tickers, 1);
  assert.equal(result.stats.excluded.below_min_price, 1);
  assert.equal(result.stats.excluded.below_min_dollar_volume, 1);
  assert.equal(result.events[0].event.ticker, "GOOD");
});

test("universe filters require enough trailing history; no filters need none", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 30);
  const earlyEvent = makeBuy({
    dedupe_key: "early",
    event_ts_ms: barMs(4),
    available_ts_ms: barMs(5) + 1_000,
  });
  insertEvents(db, [earlyEvent]);

  const withUniverse = selectEvents(db, { kind: "insider_buy", universe: { minPrice: 5 } });
  assert.equal(withUniverse.stats.selected, 0);
  assert.equal(withUniverse.stats.excluded.insufficient_history, 1);

  const withoutUniverse = selectEvents(db, { kind: "insider_buy" });
  assert.equal(withoutUniverse.stats.selected, 1);
});

test("events without an anchor or actionable bar are excluded", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 100);
  insertEvents(db, [
    makeBuy({
      dedupe_key: "before-coverage",
      event_ts_ms: barMs(0) - 5 * dayMs,
      available_ts_ms: barMs(0) - 2 * dayMs,
    }),
    makeBuy({
      dedupe_key: "last-bar",
      event_ts_ms: barMs(98),
      available_ts_ms: barMs(99) + 1_000,
    }),
  ]);

  const result = selectEvents(db, { kind: "insider_buy" });
  assert.equal(result.stats.selected, 0);
  assert.equal(result.stats.excluded.no_anchor, 2);
});
