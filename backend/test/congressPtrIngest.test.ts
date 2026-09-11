import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents } from "../src/services/eventStore.ts";
import { ingestSenatePtrs, yearsInRange } from "../src/services/congress/ptrIngest.ts";
import {
  normalizePtrTransaction,
  parseAmountRange,
  PROMPT_DISCLOSURE_MAX_LAG_DAYS,
} from "../src/services/congress/ptrNormalize.ts";
import { parseSearchRow, parseUsDateMs } from "../src/services/congress/ptrParse.ts";
import type { CongressTradePayload } from "../src/types/events.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/congress", import.meta.url));
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
  insertCandle.run("ABCD");
  return db;
}

function ingestFixtureYear(db: Database) {
  return ingestSenatePtrs({
    db,
    fromYear: 2024,
    toYear: 2024,
    cacheDir: fixturesDir,
    nowMs: Date.UTC(2025, 1, 1),
    createClient: () => {
      throw new Error("test must not touch the network");
    },
  });
}

test("yearsInRange only includes fully ended years", () => {
  assert.deepEqual(yearsInRange(2022, 2024, Date.UTC(2024, 6, 1)), [2022, 2023]);
  assert.deepEqual(yearsInRange(2024, 2024, Date.UTC(2025, 0, 1)), [2024]);
  assert.deepEqual(yearsInRange(2024, 2024, Date.UTC(2024, 11, 31, 23, 59, 59)), []);
});

test("parseUsDateMs handles valid and junk dates", () => {
  assert.equal(parseUsDateMs("03/20/2024"), Date.UTC(2024, 2, 20));
  assert.equal(parseUsDateMs("02/30/2024"), null);
  assert.equal(parseUsDateMs(""), null);
  assert.equal(parseUsDateMs("2024-03-20"), null);
});

test("parseAmountRange handles eFD range formats", () => {
  assert.deepEqual(parseAmountRange("$1,001 - $15,000"), { low: 1001, high: 15000 });
  assert.deepEqual(parseAmountRange("$15,001 - $50,000"), { low: 15001, high: 50000 });
  assert.deepEqual(parseAmountRange("Over $50,000,000"), { low: 50000000, high: null });
  assert.equal(parseAmountRange("Undetermined"), null);
  assert.equal(parseAmountRange(""), null);
});

test("parseSearchRow classifies electronic, paper, and amendment filings", () => {
  const electronic = parseSearchRow([
    "Jane Q",
    "Testerly",
    "Senator",
    '<a href="/search/view/ptr/aaaa/" target="_blank">Periodic Transaction Report for 03/20/2024</a>',
    "03/20/2024",
  ]);
  assert.deepEqual(electronic, {
    member: "Jane Q Testerly",
    filed_date_ms: Date.UTC(2024, 2, 20),
    path: "/search/view/ptr/aaaa/",
    report_id: "aaaa",
    electronic: true,
    amendment: false,
  });

  const paper = parseSearchRow([
    "Paper P",
    "Filer",
    "Senator",
    '<a href="/search/view/paper/cccc/" target="_blank">Periodic Transaction Report (Amendment) for 02/10/2024</a>',
    "02/10/2024",
  ]);
  assert.equal(paper?.electronic, false);
  assert.equal(paper?.amendment, true);

  assert.equal(
    parseSearchRow(["Broken", "Row", "Senator", "no link here", "05/01/2024"]),
    null,
  );
});

test("prompt disclosure flag flips exactly at the constant", () => {
  const filing = {
    member: "Jane Q Testerly",
    filed_date_ms: Date.UTC(2024, 2, 20),
    path: "/search/view/ptr/aaaa/",
    report_id: "aaaa",
    electronic: true,
    amendment: false,
  };
  const row = {
    owner: "Self",
    ticker: "ABCD",
    asset_name: "Acme & Sons Common Stock",
    asset_type: "Stock",
    transaction_type: "Purchase",
    amount: "$1,001 - $15,000",
    comment: "--",
  };

  const atLimit = normalizePtrTransaction(filing, {
    ...row,
    transaction_date: new Date(filing.filed_date_ms - PROMPT_DISCLOSURE_MAX_LAG_DAYS * dayMs)
      .toISOString()
      .slice(0, 10)
      .replace(/^(\d+)-(\d+)-(\d+)$/, "$2/$3/$1"),
  });
  assert.ok("event" in atLimit);
  const atLimitPayload = atLimit.event.payload as CongressTradePayload;
  assert.equal(atLimitPayload.disclosure_lag_days, PROMPT_DISCLOSURE_MAX_LAG_DAYS);
  assert.equal(atLimitPayload.prompt_disclosure, true);

  const pastLimit = normalizePtrTransaction(filing, {
    ...row,
    transaction_date: new Date(filing.filed_date_ms - (PROMPT_DISCLOSURE_MAX_LAG_DAYS + 1) * dayMs)
      .toISOString()
      .slice(0, 10)
      .replace(/^(\d+)-(\d+)-(\d+)$/, "$2/$3/$1"),
  });
  assert.ok("event" in pastLimit);
  assert.equal((pastLimit.event.payload as CongressTradePayload).prompt_disclosure, false);
});

test("fixture year normalizes to exact expected events", async () => {
  const db = makeDb();
  const summaries = await ingestFixtureYear(db);

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.year, 2024);
  assert.equal(summary.status, "completed");
  assert.equal(summary.filings, 4);
  assert.equal(summary.electronic_filings, 2);
  assert.equal(summary.paper_filings, 1);
  assert.equal(summary.amendment_filings, 1);
  assert.equal(summary.malformed_search_rows, 1);
  assert.equal(summary.inserted, 3);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.unknown_ticker_rows, 1);
  assert.deepEqual(summary.unknown_tickers, ["ZZZZ"]);
  assert.deepEqual(summary.skips, {
    non_stock: 1,
    non_trade_type: 1,
    missing_ticker: 1,
    invalid_dates: 1,
    invalid_amount: 1,
    point_in_time_violations: 1,
  });

  const buys = getEvents(db, { kind: "congress_buy" });
  assert.equal(buys.length, 2);
  const [firstBuy, overBuy] = buys;

  assert.equal(firstBuy.source, "senate_efd");
  assert.equal(firstBuy.ticker, "ABCD");
  assert.equal(firstBuy.event_ts_ms, Date.UTC(2024, 2, 1));
  assert.equal(firstBuy.available_ts_ms, endOfDayMs(2024, 2, 20));
  assert.equal(firstBuy.score, Math.log10((15001 + 50000) / 2));
  assert.deepEqual(firstBuy.payload, {
    member: "Jane Q Testerly",
    chamber: "senate",
    owner: "Self",
    transaction_type: "purchase",
    asset_name: "Acme & Sons Common Stock",
    amount_low: 15001,
    amount_high: 50000,
    reported_trade_date: "2024-03-01",
    disclosure_lag_days: 19,
    prompt_disclosure: false,
  });

  const overPayload = overBuy.payload as CongressTradePayload;
  assert.equal(overBuy.score, Math.log10(50_000_000));
  assert.equal(overPayload.amount_high, null);
  assert.equal(overPayload.disclosure_lag_days, 12);
  assert.equal(overPayload.prompt_disclosure, true);

  const sells = getEvents(db, { kind: "congress_sell" });
  assert.equal(sells.length, 1);
  const sellPayload = sells[0].payload as CongressTradePayload;
  assert.equal(sellPayload.owner, "Joint");
  assert.equal(sellPayload.transaction_type, "sale_full");
  assert.equal(sellPayload.disclosure_lag_days, 8);
  assert.equal(sellPayload.prompt_disclosure, true);
  assert.equal(sells[0].score, Math.log10((1001 + 15000) / 2));
});

test("re-ingestion is idempotent via event_ingestions", async () => {
  const db = makeDb();
  await ingestFixtureYear(db);
  const secondRun = await ingestFixtureYear(db);

  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0]!.status, "already_ingested");
  assert.equal(secondRun[0]!.inserted, 0);
  assert.equal(getEvents(db, { kinds: ["congress_buy", "congress_sell"] }).length, 3);

  const ingestions = db
    .prepare("SELECT status, inserted_rows, skipped_rows FROM event_ingestions WHERE source = 'senate_efd'")
    .all();
  assert.equal(ingestions.length, 1);
  assert.equal(String(ingestions[0].status), "completed");
  assert.equal(Number(ingestions[0].inserted_rows), 3);
  assert.equal(Number(ingestions[0].skipped_rows), 7);
});
