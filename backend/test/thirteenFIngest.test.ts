import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents } from "../src/services/eventStore.ts";
import { ingestThirteenF } from "../src/services/sec13f/thirteenFIngest.ts";
import type { InstitutionalStakePayload } from "../src/types/events.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/sec13f", import.meta.url));

const q2AcceptanceMs = Date.UTC(2024, 7, 14, 20, 5, 0);
const q2PeriodEndMs = Date.UTC(2024, 6, 1) - 1;

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insertCandle = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', 0, 1, 1, 1, 1, 100)
  `);
  insertCandle.run("BETA");
  insertCandle.run("GAMM");
  return db;
}

function ingestFixtures(db: Database) {
  return ingestThirteenF({
    db,
    fromYear: 2024,
    toYear: 2024,
    cacheDir: fixturesDir,
    nowMs: Date.UTC(2024, 9, 15),
    createClient: () => {
      throw new Error("test must not touch the network");
    },
  });
}

test("fixture quarters normalize to exact expected events", async () => {
  const db = makeDb();
  const summaries = await ingestFixtures(db);

  assert.equal(summaries.length, 2);
  const [q1, q2] = summaries;

  assert.equal(q1.quarter, "2024q1");
  assert.equal(q1.status, "completed");
  assert.equal(q1.managers_filed, 1);
  assert.equal(q1.managers_without_filing, 1);
  assert.equal(q1.managers_without_prior, 1);
  assert.equal(q1.inserted, 0);

  assert.equal(q2.quarter, "2024q2");
  assert.equal(q2.status, "completed");
  assert.equal(q2.managers_filed, 1);
  assert.equal(q2.managers_without_filing, 1);
  assert.equal(q2.managers_without_prior, 0);
  assert.equal(q2.amendments_ignored, 1);
  assert.equal(q2.inserted, 2);
  assert.equal(q2.duplicates, 0);
  assert.equal(q2.unknown_ticker_rows, 1);
  assert.deepEqual(q2.unknown_tickers, ["NOPE"]);
  assert.equal(q2.unmapped_cusips, 1);
  assert.deepEqual(q2.skips, {
    option_rows: 1,
    principal_rows: 1,
    malformed_rows: 1,
    unmapped_cusip_rows: 1,
    empty_filings: 0,
  });

  const newStakes = getEvents(db, { kind: "inst_new_stake" });
  assert.equal(newStakes.length, 1);
  const stake = newStakes[0];
  assert.equal(stake.source, "sec_13f");
  assert.equal(stake.ticker, "GAMM");
  assert.equal(stake.event_ts_ms, q2PeriodEndMs);
  assert.equal(stake.available_ts_ms, q2AcceptanceMs);
  assert.equal(stake.score, 0.25);
  assert.equal(stake.dedupe_key, "13f|111|2024-06-30|33333333|inst_new_stake");
  assert.deepEqual(stake.payload, {
    manager: "Test Capital",
    cik: 111,
    period: "2024-06-30",
    prior_period: "2024-03-31",
    cusip: "33333333",
    issuer_name: "Gamma Ltd",
    value_usd: 2_500_000,
    shares: 500,
    portfolio_share: 0.25,
    portfolio_total_usd: 10_000_000,
    filing_lag_days: 44,
  });

  const exits = getEvents(db, { kind: "inst_exit" });
  assert.equal(exits.length, 1);
  const exit = exits[0];
  assert.equal(exit.ticker, "BETA");
  assert.equal(exit.event_ts_ms, q2PeriodEndMs);
  assert.equal(exit.available_ts_ms, q2AcceptanceMs);
  assert.equal(exit.score, 0.4);
  const exitPayload = exit.payload as InstitutionalStakePayload;
  assert.equal(exitPayload.cusip, "22222222");
  assert.equal(exitPayload.issuer_name, "Beta Inc");
  assert.equal(exitPayload.value_usd, 4_000_000);
  assert.equal(exitPayload.shares, 2000);
  assert.equal(exitPayload.portfolio_share, 0.4);
  assert.equal(exitPayload.portfolio_total_usd, 10_000_000);
  assert.equal(exitPayload.filing_lag_days, 44);
});

test("re-ingestion is idempotent via event_ingestions", async () => {
  const db = makeDb();
  await ingestFixtures(db);
  const secondRun = await ingestFixtures(db);

  assert.equal(secondRun.length, 2);
  assert.ok(secondRun.every((summary) => summary.status === "already_ingested"));
  assert.equal(getEvents(db, { kinds: ["inst_new_stake", "inst_exit"] }).length, 2);

  const ingestions = db
    .prepare(
      "SELECT status, inserted_rows, skipped_rows FROM event_ingestions WHERE source = 'sec_13f' ORDER BY id",
    )
    .all();
  assert.equal(ingestions.length, 2);
  assert.ok(ingestions.every((row) => String(row.status) === "completed"));
  assert.equal(Number(ingestions[1].inserted_rows), 2);
  assert.equal(Number(ingestions[1].skipped_rows), 5);
});
