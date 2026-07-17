import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents, insertEvents } from "../src/services/eventStore.ts";
import {
  defaultClusterParams,
  deriveInsiderClusterBuys,
} from "../src/services/sec/form4Clusters.ts";
import { ingestForm4 } from "../src/services/sec/form4Ingest.ts";
import type { EventRecord } from "../src/types/events.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/sec", import.meta.url));
const dayMs = 86_400_000;

function endOfDayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) + dayMs - 1;
}

function makeDb(tickers: string[] = ["FMBH", "TOL"]): Database {
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

let buySequence = 0;

function makeBuy(options: {
  ticker: string;
  day: number;
  insiderName: string;
  dollarValue: number | null;
  filedDay?: number;
}): EventRecord<"insider_buy"> {
  buySequence += 1;
  const eventTsMs = Date.UTC(2024, 0, options.day);
  return {
    source: "sec_form4",
    ticker: options.ticker,
    event_kind: "insider_buy",
    event_ts_ms: eventTsMs,
    available_ts_ms: endOfDayMs(2024, 0, options.filedDay ?? options.day),
    score: null,
    payload: {
      insider_name: options.insiderName,
      is_officer: false,
      is_director: true,
      is_ten_percent_owner: false,
      shares: 100,
      price: options.dollarValue == null ? null : options.dollarValue / 100,
      dollar_value: options.dollarValue,
    },
    dedupe_key: `test_buy:${buySequence}`,
  };
}

function getClusters(db: Database) {
  return getEvents(db, { kind: "insider_cluster_buy" });
}

test("fixture quarter derives exactly one cluster with default params", async () => {
  const db = makeDb();
  await ingestForm4({
    db,
    fromYear: 2024,
    toYear: 2024,
    userAgent: "geridon test",
    cacheDir: fixturesDir,
    nowMs: Date.UTC(2024, 3, 15),
  });

  const summary = deriveInsiderClusterBuys(db);
  assert.equal(summary.buys_considered, 4);
  assert.equal(summary.clusters_inserted, 1);
  assert.equal(summary.previous_clusters_removed, 0);

  const clusters = getClusters(db);
  assert.equal(clusters.length, 1);
  const cluster = clusters[0]!;
  assert.equal(cluster.ticker, "FMBH");
  assert.equal(cluster.event_ts_ms, Date.UTC(2024, 0, 27));
  assert.equal(cluster.available_ts_ms, endOfDayMs(2024, 0, 31));
  assert.equal(cluster.score, Math.log10(112_100));
  assert.deepEqual(cluster.payload, {
    insider_count: 3,
    insider_names: ["Poe Edgar", "Quill Sam", "Roe Jane"],
    window_days: 10,
    combined_dollar_value: 112_100,
  });
  assert.match(cluster.dedupe_key, /^sec_form4:cluster:FMBH:[0-9a-f]{16}$/);

  const rerun = deriveInsiderClusterBuys(db);
  assert.equal(rerun.previous_clusters_removed, 1);
  assert.equal(rerun.clusters_inserted, 1);
  assert.equal(getClusters(db).length, 1);
});

test("distinct insiders below the combined value threshold form no cluster", () => {
  const db = makeDb();
  insertEvents(db, [
    makeBuy({ ticker: "FMBH", day: 2, insiderName: "A", dollarValue: 60_000 }),
    makeBuy({ ticker: "FMBH", day: 3, insiderName: "B", dollarValue: 30_000 }),
  ]);
  const summary = deriveInsiderClusterBuys(db);
  assert.equal(summary.clusters_inserted, 0);
});

test("one insider buying repeatedly is never a cluster", () => {
  const db = makeDb();
  insertEvents(db, [
    makeBuy({ ticker: "FMBH", day: 2, insiderName: "A", dollarValue: 90_000 }),
    makeBuy({ ticker: "FMBH", day: 3, insiderName: "A", dollarValue: 90_000 }),
  ]);
  assert.equal(deriveInsiderClusterBuys(db).clusters_inserted, 0);
});

test("buys outside the window do not combine", () => {
  const db = makeDb();
  insertEvents(db, [
    makeBuy({ ticker: "FMBH", day: 1, insiderName: "A", dollarValue: 60_000 }),
    makeBuy({ ticker: "FMBH", day: 12, insiderName: "B", dollarValue: 60_000 }),
    makeBuy({ ticker: "TOL", day: 1, insiderName: "C", dollarValue: 60_000 }),
    makeBuy({ ticker: "TOL", day: 11, insiderName: "D", dollarValue: 60_000 }),
  ]);
  const summary = deriveInsiderClusterBuys(db);
  assert.equal(summary.clusters_inserted, 1);
  assert.equal(getClusters(db)[0]!.ticker, "TOL");
});

test("emitting a cluster consumes its window", () => {
  const db = makeDb();
  insertEvents(db, [
    makeBuy({ ticker: "FMBH", day: 1, insiderName: "A", dollarValue: 60_000 }),
    makeBuy({ ticker: "FMBH", day: 2, insiderName: "B", dollarValue: 60_000 }),
    makeBuy({ ticker: "FMBH", day: 3, insiderName: "C", dollarValue: 60_000 }),
  ]);
  const summary = deriveInsiderClusterBuys(db);
  assert.equal(summary.clusters_inserted, 1);
  const cluster = getClusters(db)[0]!;
  assert.deepEqual(cluster.payload.insider_names, ["A", "B"]);
  assert.equal(cluster.event_ts_ms, Date.UTC(2024, 0, 2));
});

test("availability is the latest member filing, joint names split, null values count zero", () => {
  const db = makeDb();
  insertEvents(db, [
    makeBuy({ ticker: "FMBH", day: 2, insiderName: "A; B", dollarValue: null, filedDay: 9 }),
    makeBuy({ ticker: "FMBH", day: 3, insiderName: "C", dollarValue: 120_000, filedDay: 4 }),
  ]);
  const summary = deriveInsiderClusterBuys(db, { ...defaultClusterParams, minInsiders: 3 });
  assert.equal(summary.clusters_inserted, 1);
  const cluster = getClusters(db)[0]!;
  assert.equal(cluster.available_ts_ms, endOfDayMs(2024, 0, 9));
  assert.deepEqual(cluster.payload, {
    insider_count: 3,
    insider_names: ["A", "B", "C"],
    window_days: 10,
    combined_dollar_value: 120_000,
  });
});
