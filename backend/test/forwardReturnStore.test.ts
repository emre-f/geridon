import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { labelVersion, type CloseBar } from "../src/services/forwardReturns.ts";
import {
  computeAndStoreForwardReturns,
  getForwardReturnCoverage,
  getForwardReturns,
  storeForwardReturns,
} from "../src/services/forwardReturnStore.ts";

const dayMs = 24 * 60 * 60 * 1000;
const baseMs = Date.parse("2024-01-01T00:00:00.000Z");

function bar(day: number, close: number): CloseBar {
  return { timestamp_ms: baseMs + day * dayMs, close };
}

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

test("compute-and-store then read back round-trips exactly", () => {
  const db = makeDb();
  const bars = [bar(0, 100), bar(1, 100), bar(2, 110), bar(3, 121)];
  const marketBars = [bar(0, 400), bar(1, 400), bar(2, 420), bar(3, 441)];

  const stored = computeAndStoreForwardReturns(db, {
    ticker: "aapl ",
    bars,
    marketBars,
    horizons: [1, 2],
  });
  assert.equal(stored, bars.length * 2);

  const rows = getForwardReturns(db, { ticker: "AAPL" });
  assert.equal(rows.length, bars.length * 2);

  const first = rows.find((row) => row.timestamp_ms === baseMs && row.horizon === 1);
  assert.ok(first);
  assert.ok(Math.abs(first.raw! - 0.1) < 1e-12);
  assert.ok(Math.abs(first.market_adjusted! - (0.1 - 0.05)) < 1e-12);

  const last = rows.find((row) => row.timestamp_ms === baseMs + 3 * dayMs && row.horizon === 2);
  assert.ok(last);
  assert.equal(last.raw, null);
  assert.equal(last.market_adjusted, null);
});

test("re-storing a ticker replaces its previous rows", () => {
  const db = makeDb();
  computeAndStoreForwardReturns(db, {
    ticker: "MSFT",
    bars: [bar(0, 100), bar(1, 100), bar(2, 110)],
    horizons: [1],
  });
  computeAndStoreForwardReturns(db, {
    ticker: "MSFT",
    bars: [bar(0, 100), bar(1, 100)],
    horizons: [1],
  });

  const rows = getForwardReturns(db, { ticker: "MSFT" });
  assert.equal(rows.length, 2);
});

test("rows from other tickers and stale label versions are not returned", () => {
  const db = makeDb();
  computeAndStoreForwardReturns(db, {
    ticker: "MSFT",
    bars: [bar(0, 100), bar(1, 110)],
    horizons: [1],
  });
  db.prepare(`
    INSERT INTO forward_returns (ticker, label_version, timestamp_ms, horizon, raw, market_adjusted)
    VALUES ('AAPL', ?, ?, 1, 0.5, 0.5)
  `).run(labelVersion - 1, baseMs);

  assert.equal(getForwardReturns(db, { ticker: "AAPL" }).length, 0);
  assert.equal(getForwardReturns(db, { ticker: "MSFT" }).length, 2);
});

test("range and horizon filters narrow the result", () => {
  const db = makeDb();
  storeForwardReturns(db, "AAPL", [
    { timestamp_ms: baseMs, horizon: 1, raw: 0.01, market_adjusted: null },
    { timestamp_ms: baseMs, horizon: 5, raw: 0.02, market_adjusted: null },
    { timestamp_ms: baseMs + dayMs, horizon: 1, raw: 0.03, market_adjusted: null },
    { timestamp_ms: baseMs + 2 * dayMs, horizon: 5, raw: 0.04, market_adjusted: null },
  ]);

  const ranged = getForwardReturns(db, {
    ticker: "AAPL",
    startMs: baseMs + dayMs,
    endMs: baseMs + 2 * dayMs,
  });
  assert.deepEqual(
    ranged.map((row) => row.raw),
    [0.03, 0.04],
  );

  const horizonOnly = getForwardReturns(db, { ticker: "AAPL", horizons: [5] });
  assert.deepEqual(
    horizonOnly.map((row) => row.raw),
    [0.02, 0.04],
  );
});

test("coverage summarizes stored rows and is null when empty", () => {
  const db = makeDb();
  assert.equal(getForwardReturnCoverage(db, "AAPL"), null);

  computeAndStoreForwardReturns(db, {
    ticker: "AAPL",
    bars: [bar(0, 100), bar(1, 100), bar(2, 110)],
    horizons: [1],
  });

  const coverage = getForwardReturnCoverage(db, "AAPL");
  assert.deepEqual(coverage, {
    rows: 3,
    first_timestamp_ms: baseMs,
    last_timestamp_ms: baseMs + 2 * dayMs,
  });
});
