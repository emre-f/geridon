import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents, insertEvents } from "../src/services/eventStore.ts";
import { collectFilingEvents } from "../src/services/sec/eightKEventsRun.ts";
import { labelSetToEvents } from "../src/services/sec/eightKLabelEvents.ts";
import type { FilingLabel } from "../src/services/sec/eightKLabelSchema.ts";
import type { CachedFiling, StoredLabelSet } from "../src/services/sec/eightKLabelStore.ts";
import type { FilingLabelEventPayload } from "../src/types/events.ts";

const version = "gpt-5.5-testtesttest";
const acceptanceMs = Date.UTC(2024, 4, 2, 20, 5, 0);

function label(overrides: Partial<FilingLabel> = {}): FilingLabel {
  return {
    kind: "guidance",
    direction: "up",
    severity: 3,
    rationale: "raised full-year outlook",
    guidance: [],
    ...overrides,
  };
}

function filing(overrides: Partial<CachedFiling> = {}): CachedFiling {
  return {
    cik: 320193,
    accession_path: "000032019324000050",
    dir: "/unused",
    form: "8-K",
    items: ["2.02"],
    filed_date: "2024-05-02",
    acceptance_ts_ms: acceptanceMs,
    primary: "body.htm",
    exhibits: [],
    ...overrides,
  };
}

function labelSet(labels: FilingLabel[]): StoredLabelSet {
  return { labels, labeler_version: version, labeled_at: "2024-05-03T00:00:00.000Z" };
}

test("directional labels map to their event kind with severity as the score", () => {
  const cases: Array<[FilingLabel, string]> = [
    [label({ direction: "up" }), "filing_guidance_up"],
    [label({ direction: "down", severity: 5 }), "filing_guidance_down"],
    [label({ kind: "buyback", direction: "up", severity: 2 }), "filing_buyback"],
    [label({ kind: "exec_departure_unplanned", direction: "down", severity: 4 }), "filing_exec_departure"],
  ];
  for (const [input, expected] of cases) {
    const { events, skips } = labelSetToEvents(filing(), labelSet([input]), "AAPL");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_kind, expected);
    assert.equal(events[0].score, input.severity);
    assert.equal(events[0].event_ts_ms, acceptanceMs);
    assert.equal(events[0].available_ts_ms, acceptanceMs);
    assert.equal(skips.guidance_neutral + skips.exec_departure_routine, 0);
  }
});

test("neutral guidance and routine departures are counted, never emitted", () => {
  const { events, skips } = labelSetToEvents(
    filing(),
    labelSet([
      label({ direction: "none" }),
      label({ kind: "exec_departure_routine", direction: "none", severity: 1 }),
    ]),
    "AAPL",
  );
  assert.equal(events.length, 0);
  assert.equal(skips.guidance_neutral, 1);
  assert.equal(skips.exec_departure_routine, 1);
});

test("payload carries the guidance figures, labeler version and dedupe identity", () => {
  const figure = { metric: "revenue", period: "Q3 2024", unit: "USD billions", low: 49, high: 52, point: null };
  const { events } = labelSetToEvents(
    filing(),
    labelSet([label({ direction: "up", guidance: [figure] }), label({ direction: "down" })]),
    "AAPL",
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].payload.guidance, [figure]);
  assert.equal(events[0].payload.labeler_version, version);
  assert.equal(events[0].payload.cik, 320193);
  assert.deepEqual(events[0].payload.items, ["2.02"]);
  assert.equal(events[0].dedupe_key, `sec_8k|${version}|000032019324000050|0|filing_guidance_up`);
  assert.equal(events[1].dedupe_key, `sec_8k|${version}|000032019324000050|1|filing_guidance_down`);
});

async function writeFilingCache(
  cacheDir: string,
  spec: { cik: number; ticker: string; accession: string; items: string[]; labels?: FilingLabel[] },
): Promise<void> {
  await mkdir(join(cacheDir, "listings"), { recursive: true });
  await writeFile(
    join(cacheDir, "listings", `${spec.ticker}.json`),
    JSON.stringify({ ticker: spec.ticker, cik: spec.cik }),
  );
  const dir = join(cacheDir, "filings", String(spec.cik), spec.accession);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "documents.json"),
    JSON.stringify({
      form: "8-K",
      items: spec.items,
      filed_date: "2024-05-02",
      acceptance_ts_ms: acceptanceMs,
      primary: "body.htm",
      exhibits: [],
    }),
  );
  if (spec.labels != null) {
    await mkdir(join(dir, "labels"), { recursive: true });
    await writeFile(join(dir, "labels", `${version}.json`), JSON.stringify(labelSet(spec.labels)));
  }
}

test("collectFilingEvents walks the cache, respecting items and missing labels", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "sec8k-events-"));
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-1",
    items: ["2.02"],
    labels: [label({ direction: "up" })],
  });
  await writeFilingCache(cacheDir, {
    cik: 2,
    ticker: "BBB",
    accession: "bbb-1",
    items: ["5.02"],
    labels: undefined,
  });
  await writeFilingCache(cacheDir, {
    cik: 3,
    ticker: "CCC",
    accession: "ccc-1",
    items: ["7.01"],
    labels: [label({ direction: "up" })],
  });

  const run = await collectFilingEvents({ labelerVersion: version, cacheDir, items: ["2.02", "5.02"] });

  assert.equal(run.filings_considered, 2);
  assert.equal(run.filings_labeled, 1);
  assert.equal(run.filings_unlabeled, 1);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].ticker, "AAA");
});

test("a filing whose CIK has no listing is skipped rather than emitted tickerless", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "sec8k-events-"));
  const dir = join(cacheDir, "filings", "999", "orphan-1");
  await mkdir(join(dir, "labels"), { recursive: true });
  await writeFile(
    join(dir, "documents.json"),
    JSON.stringify({ form: "8-K", items: ["2.02"], filed_date: "2024-05-02", acceptance_ts_ms: acceptanceMs, primary: "body.htm", exhibits: [] }),
  );
  await writeFile(join(dir, "labels", `${version}.json`), JSON.stringify(labelSet([label()])));

  const run = await collectFilingEvents({ labelerVersion: version, cacheDir });
  assert.equal(run.filings_without_ticker, 1);
  assert.equal(run.events.length, 0);
});

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  db.prepare(
    "INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume) VALUES (?, 1, 'day', 0, 1, 1, 1, 1, 100)",
  ).run("AAA");
  return db;
}

test("collected events insert into the store and re-running is idempotent", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "sec8k-events-"));
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-1",
    items: ["2.02"],
    labels: [label({ direction: "up", severity: 4 }), label({ kind: "buyback", severity: 2 })],
  });

  const db = makeDb();
  const run = await collectFilingEvents({ labelerVersion: version, cacheDir });
  const first = insertEvents(db, run.events);
  assert.equal(first.inserted, 2);

  const second = insertEvents(db, run.events);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 2);

  const stored = getEvents(db, { kind: "filing_guidance_up" });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].score, 4);
  assert.equal((stored[0].payload as FilingLabelEventPayload).labeler_version, version);
});
