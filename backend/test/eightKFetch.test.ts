import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import type { EdgarClient } from "../src/services/sec/edgarClient.ts";
import {
  filingFileUrl,
  indexHeadersUrl,
  parseDocumentManifest,
  selectDocumentFiles,
} from "../src/services/sec/eightKDocs.ts";
import { fetchEightKFilings } from "../src/services/sec/eightKFetch.ts";
import {
  extractEightKFilings,
  neededPages,
  submissionsUrl,
  type SubmissionsJson,
} from "../src/services/sec/eightKListing.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/sec8k", import.meta.url));
const submissions = JSON.parse(
  readFileSync(join(fixturesDir, "submissions.json"), "utf8"),
) as SubmissionsJson;
const indexHeadersHtml = readFileSync(join(fixturesDir, "index-headers.html"), "utf8");

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES ('ABCD', 1, 'day', 0, 1, 1, 1, 1, 100)
  `).run();
  return db;
}

function fixtureClient(calls: string[]): EdgarClient {
  const jsonByUrl = new Map<string, string>([
    [
      "https://www.sec.gov/files/company_tickers.json",
      JSON.stringify({ "0": { cik_str: 1111, ticker: "ABCD", title: "Abcd Inc" } }),
    ],
    [submissionsUrl(1111), JSON.stringify(submissions)],
  ]);
  const textByUrl = new Map<string, string | null>([
    [indexHeadersUrl(1111, "0000001111-24-000001"), indexHeadersHtml],
    [indexHeadersUrl(1111, "0000001111-24-000002"), indexHeadersHtml],
    [filingFileUrl(1111, "0000001111-24-000001", "body1.htm"), "<html>8-K body</html>"],
    [filingFileUrl(1111, "0000001111-24-000001", "press991.htm"), "<html>press</html>"],
    [filingFileUrl(1111, "0000001111-24-000002", "body1.htm"), "<html>amended body</html>"],
    [filingFileUrl(1111, "0000001111-24-000002", "press991.htm"), null],
  ]);

  return {
    async fetchJson<T>(url: string): Promise<T> {
      calls.push(url);
      const body = jsonByUrl.get(url);
      assert.ok(body != null, `unexpected JSON fetch: ${url}`);
      return JSON.parse(body) as T;
    },
    async fetchText(url: string): Promise<string | null> {
      calls.push(url);
      assert.ok(textByUrl.has(url), `unexpected text fetch: ${url}`);
      return textByUrl.get(url)!;
    },
  };
}

function runFetch(db: Database, cacheDir: string, client: () => EdgarClient) {
  return fetchEightKFilings({
    db,
    fromYear: 2024,
    toYear: 2024,
    userAgent: "test-agent",
    cacheDir,
    nowMs: Date.UTC(2025, 0, 15),
    createClient: client,
  });
}

test("extractEightKFilings keeps only target items in the window", () => {
  const filings = extractEightKFilings(
    submissions.filings.recent,
    Date.UTC(2024, 0, 1),
    Date.UTC(2024, 11, 31, 23, 59, 59),
  );
  assert.deepEqual(
    filings.map((filing) => filing.accession),
    ["0000001111-24-000002", "0000001111-24-000001"],
  );
  const [amendment, original] = filings;
  assert.equal(amendment.form, "8-K/A");
  assert.deepEqual(amendment.items, ["5.02"]);
  assert.equal(amendment.primary_document, "");
  assert.equal(original.form, "8-K");
  assert.deepEqual(original.items, ["2.02", "9.01"]);
  assert.equal(original.acceptance_ts_ms, Date.parse("2024-05-01T20:30:41.000Z"));
  assert.equal(original.filed_date, "2024-05-01");

  const early = extractEightKFilings(
    submissions.filings.recent,
    Date.UTC(2015, 0, 1),
    Date.UTC(2015, 11, 31),
  );
  assert.deepEqual(early.map((filing) => filing.accession), ["0000001111-15-000009"]);
});

test("neededPages only includes pages overlapping the window", () => {
  const files = submissions.filings.files!;
  assert.deepEqual(neededPages(files, Date.UTC(2024, 0, 1), Date.UTC(2024, 11, 31)), []);
  assert.equal(neededPages(files, Date.UTC(2015, 0, 1), Date.UTC(2024, 11, 31)).length, 1);
  assert.equal(neededPages(files, Date.UTC(2015, 5, 1), Date.UTC(2024, 11, 31)).length, 1);
  assert.deepEqual(neededPages(files, Date.UTC(2016, 0, 1), Date.UTC(2024, 11, 31)), []);
});

test("parseDocumentManifest reads the escaped SGML document list", () => {
  const manifest = parseDocumentManifest(indexHeadersHtml);
  assert.deepEqual(manifest, [
    { type: "8-K", sequence: 1, filename: "body1.htm" },
    { type: "EX-99.1", sequence: 2, filename: "press991.htm" },
    { type: "EX-99.2", sequence: 3, filename: "chart.jpg" },
    { type: "EX-101.SCH", sequence: 4, filename: "abcd-2024.xsd" },
  ]);
});

test("selectDocumentFiles keeps text EX-99 exhibits and falls back for the primary", () => {
  const manifest = parseDocumentManifest(indexHeadersHtml);
  assert.deepEqual(selectDocumentFiles(manifest, "body1.htm"), {
    primary: "body1.htm",
    exhibits: ["press991.htm"],
  });
  assert.deepEqual(selectDocumentFiles(manifest, ""), {
    primary: "body1.htm",
    exhibits: ["press991.htm"],
  });
  assert.deepEqual(selectDocumentFiles([], ""), { primary: null, exhibits: [] });
});

test("fetch caches listings and documents, marking missing exhibits", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "sec8k-"));
  try {
    const calls: string[] = [];
    const summary = await runFetch(makeDb(), cacheDir, () => fixtureClient(calls));

    assert.equal(summary.tickers, 1);
    assert.deepEqual(summary.tickers_without_cik, []);
    assert.equal(summary.listings_fetched, 1);
    assert.equal(summary.listings_cached, 0);
    assert.equal(summary.filings, 2);
    assert.equal(summary.filings_fetched, 2);
    assert.equal(summary.filings_cached, 0);
    assert.equal(summary.documents_fetched, 5);
    assert.equal(summary.missing_documents, 1);
    assert.deepEqual(summary.filings_per_year, { "2024": 2 });

    const firstDir = join(cacheDir, "filings", "1111", "000000111124000001");
    const firstRecord = JSON.parse(readFileSync(join(firstDir, "documents.json"), "utf8"));
    assert.equal(firstRecord.primary, "body1.htm");
    assert.deepEqual(firstRecord.exhibits, ["press991.htm"]);
    assert.deepEqual(firstRecord.missing, []);
    assert.equal(readFileSync(join(firstDir, "body1.htm"), "utf8"), "<html>8-K body</html>");

    const secondDir = join(cacheDir, "filings", "1111", "000000111124000002");
    const secondRecord = JSON.parse(readFileSync(join(secondDir, "documents.json"), "utf8"));
    assert.equal(secondRecord.form, "8-K/A");
    assert.deepEqual(secondRecord.missing, ["press991.htm"]);
    assert.ok(existsSync(join(secondDir, "press991.htm.missing")));
    assert.ok(existsSync(join(cacheDir, "listings", "ABCD.json")));
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("a re-run is served entirely from the cache", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "sec8k-"));
  try {
    const calls: string[] = [];
    await runFetch(makeDb(), cacheDir, () => fixtureClient(calls));
    const rerun = await runFetch(makeDb(), cacheDir, () => {
      throw new Error("re-run must not touch the network");
    });

    assert.equal(rerun.listings_cached, 1);
    assert.equal(rerun.listings_fetched, 0);
    assert.equal(rerun.filings_cached, 2);
    assert.equal(rerun.filings_fetched, 0);
    assert.equal(rerun.documents_fetched, 0);
    assert.equal(rerun.missing_documents, 0);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("tickers without a CIK mapping are reported, not fetched", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "sec8k-"));
  try {
    const calls: string[] = [];
    const summary = await fetchEightKFilings({
      db: makeDb(),
      fromYear: 2024,
      toYear: 2024,
      userAgent: "test-agent",
      tickers: ["ZZZZ"],
      cacheDir,
      nowMs: Date.UTC(2025, 0, 15),
      createClient: () => fixtureClient(calls),
    });
    assert.deepEqual(summary.tickers_without_cik, ["ZZZZ"]);
    assert.equal(summary.filings, 0);
    assert.deepEqual(calls, ["https://www.sec.gov/files/company_tickers.json"]);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
