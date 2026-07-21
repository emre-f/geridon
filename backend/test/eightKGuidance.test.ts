import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { getEvents, insertEvents } from "../src/services/eventStore.ts";
import {
  guidanceMidpoint,
  tickerGuidanceEvents,
} from "../src/services/sec/eightKGuidanceEvents.ts";
import { collectGuidanceEvents } from "../src/services/sec/eightKGuidanceRun.ts";
import type { FilingLabel, GuidanceFigure } from "../src/services/sec/eightKLabelSchema.ts";
import type { CachedFiling, StoredLabelSet } from "../src/services/sec/eightKLabelStore.ts";
import type { GuidanceRevisionPayload } from "../src/types/events.ts";

const version = "gpt-5.5-testtesttest";
const day = 24 * 60 * 60 * 1000;
const firstAcceptance = Date.UTC(2024, 0, 30, 21, 0, 0);

function figure(overrides: Partial<GuidanceFigure> = {}): GuidanceFigure {
  return {
    metric: "revenue",
    period: "FY2024",
    unit: "USD billions",
    low: null,
    high: null,
    point: 100,
    ...overrides,
  };
}

function guidanceLabel(figures: GuidanceFigure[]): FilingLabel {
  return { kind: "guidance", direction: "none", severity: 3, rationale: "outlook", guidance: figures };
}

function filing(index: number, figures: GuidanceFigure[]): {
  filing: CachedFiling;
  labelSet: StoredLabelSet;
} {
  const accession = `acc-${index}`;
  return {
    filing: {
      cik: 320193,
      accession_path: accession,
      dir: "/unused",
      form: "8-K",
      items: ["2.02"],
      filed_date: "2024-05-02",
      acceptance_ts_ms: firstAcceptance + index * 90 * day,
      primary: "body.htm",
      exhibits: [],
    },
    labelSet: {
      labels: [guidanceLabel(figures)],
      labeler_version: version,
      labeled_at: "2024-05-03T00:00:00.000Z",
    },
  };
}

test("guidanceMidpoint prefers point, then range, then a single open bound", () => {
  assert.equal(guidanceMidpoint(figure({ point: 42, low: 1, high: 2 })), 42);
  assert.equal(guidanceMidpoint(figure({ point: null, low: 40, high: 60 })), 50);
  assert.equal(guidanceMidpoint(figure({ point: null, low: 30, high: null })), 30);
  assert.equal(guidanceMidpoint(figure({ point: null, low: null, high: 70 })), 70);
  assert.equal(guidanceMidpoint(figure({ point: null, low: null, high: null })), null);
});

test("a first guide is an initiation, then a higher midpoint raises and a lower one cuts", () => {
  const { events, skips } = tickerGuidanceEvents(
    [
      filing(0, [figure({ point: 100 })]),
      filing(1, [figure({ point: 110 })]),
      filing(2, [figure({ point: 105 })]),
    ],
    "AAPL",
    version,
  );

  assert.equal(skips.initiation, 1);
  assert.equal(events.length, 2);

  assert.equal(events[0].event_kind, "guidance_raise");
  assert.ok(Math.abs(events[0].score! - 0.1) < 1e-9);
  const raise = events[0].payload as GuidanceRevisionPayload;
  assert.ok(Math.abs(raise.revision_pct! - 0.1) < 1e-9);
  assert.equal(raise.prior_midpoint, 100);
  assert.equal(raise.new_midpoint, 110);
  assert.equal(raise.prior_accession, "acc-0");
  assert.equal(raise.withdrawn, false);

  assert.equal(events[1].event_kind, "guidance_cut");
  assert.ok(Math.abs(events[1].score! - (5 / 110)) < 1e-9);
  const cut = events[1].payload as GuidanceRevisionPayload;
  assert.ok(cut.revision_pct! < 0);
  assert.equal(cut.prior_midpoint, 110);
  assert.equal(cut.prior_accession, "acc-1");
});

test("an unchanged midpoint is a reaffirmation, never an event", () => {
  const { events, skips } = tickerGuidanceEvents(
    [filing(0, [figure({ point: 100 })]), filing(1, [figure({ point: 100 })])],
    "AAPL",
    version,
  );
  assert.equal(events.length, 0);
  assert.equal(skips.initiation, 1);
  assert.equal(skips.reaffirmation, 1);
});

test("a figure with no number withdraws the outlook as a severe cut with a null score", () => {
  const { events, skips } = tickerGuidanceEvents(
    [
      filing(0, [figure({ point: 100 })]),
      filing(1, [figure({ point: null, low: null, high: null })]),
    ],
    "AAPL",
    version,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_kind, "guidance_cut");
  assert.equal(events[0].score, null);
  const payload = events[0].payload as GuidanceRevisionPayload;
  assert.equal(payload.withdrawn, true);
  assert.equal(payload.new_midpoint, null);
  assert.equal(payload.revision_pct, null);
  assert.equal(payload.prior_midpoint, 100);
  assert.equal(skips.initiation, 1);
});

test("a withdrawal clears the baseline, so a later re-issue is a fresh initiation", () => {
  const { events, skips } = tickerGuidanceEvents(
    [
      filing(0, [figure({ point: 100 })]),
      filing(1, [figure({ point: null, low: null, high: null })]),
      filing(2, [figure({ point: 120 })]),
    ],
    "AAPL",
    version,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_kind, "guidance_cut");
  assert.equal(skips.initiation, 2);
});

test("a withdrawal with no prior guide is counted, never emitted", () => {
  const { events, skips } = tickerGuidanceEvents(
    [filing(0, [figure({ point: null, low: null, high: null })])],
    "AAPL",
    version,
  );
  assert.equal(events.length, 0);
  assert.equal(skips.withdrawal_no_prior, 1);
});

test("guides for different metrics, periods or units are tracked independently", () => {
  const { events, skips } = tickerGuidanceEvents(
    [
      filing(0, [
        figure({ metric: "revenue", point: 100 }),
        figure({ metric: "eps", unit: "USD", point: 4 }),
      ]),
      filing(1, [
        figure({ metric: "revenue", point: 110 }),
        figure({ metric: "revenue", period: "FY2025", point: 130 }),
        figure({ metric: "revenue", unit: "USD millions", point: 100000 }),
      ]),
    ],
    "AAPL",
    version,
  );
  const raises = events.filter((event) => event.event_kind === "guidance_raise");
  assert.equal(raises.length, 1);
  const raised = raises[0].payload as GuidanceRevisionPayload;
  assert.equal(raised.new_figure.period, "FY2024");
  assert.equal(raised.new_figure.unit, "USD billions");
  assert.equal(skips.initiation, 4);
});

test("metric, period and unit match on case and collapsed whitespace", () => {
  const { events } = tickerGuidanceEvents(
    [
      filing(0, [figure({ metric: "Revenue", period: "FY2024", unit: "USD  Billions", point: 100 })]),
      filing(1, [figure({ metric: "revenue", period: "fy2024", unit: "usd billions", point: 110 })]),
    ],
    "AAPL",
    version,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_kind, "guidance_raise");
});

test("period strings that differ only in spacing do not match (conservative miss)", () => {
  const { events, skips } = tickerGuidanceEvents(
    [
      filing(0, [figure({ period: "FY 2024", point: 100 })]),
      filing(1, [figure({ period: "FY2024", point: 110 })]),
    ],
    "AAPL",
    version,
  );
  assert.equal(events.length, 0);
  assert.equal(skips.initiation, 2);
});

test("a figure missing metric, period or unit is skipped, never crashes the walk", () => {
  const legacy = { metric: "revenue", period: "FY2024", low: null, high: null, point: 110 } as GuidanceFigure;
  const { events, skips } = tickerGuidanceEvents(
    [filing(0, [figure({ point: 100 })]), filing(1, [legacy])],
    "AAPL",
    version,
  );
  assert.equal(events.length, 0);
  assert.equal(skips.initiation, 1);
  assert.equal(skips.incomparable, 1);
});

test("event_ts equals available_ts equals the revising filing's acceptance datetime", () => {
  const filings = [filing(0, [figure({ point: 100 })]), filing(1, [figure({ point: 110 })])];
  const { events } = tickerGuidanceEvents(filings, "AAPL", version);
  assert.equal(events[0].event_ts_ms, filings[1].filing.acceptance_ts_ms);
  assert.equal(events[0].available_ts_ms, filings[1].filing.acceptance_ts_ms);
});

async function writeFilingCache(
  cacheDir: string,
  spec: {
    cik: number;
    ticker: string;
    accession: string;
    index: number;
    items: string[];
    figures?: GuidanceFigure[];
  },
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
      acceptance_ts_ms: firstAcceptance + spec.index * 90 * day,
      primary: "body.htm",
      exhibits: [],
    }),
  );
  if (spec.figures != null) {
    await mkdir(join(dir, "labels"), { recursive: true });
    await writeFile(
      join(dir, "labels", `${version}.json`),
      JSON.stringify({
        labels: [guidanceLabel(spec.figures)],
        labeler_version: version,
        labeled_at: "2024-05-03T00:00:00.000Z",
      }),
    );
  }
}

test("collectGuidanceEvents groups a ticker's filings and respects items and missing labels", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "sec8k-guidance-"));
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-0",
    index: 0,
    items: ["2.02"],
    figures: [figure({ point: 100 })],
  });
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-1",
    index: 1,
    items: ["2.02"],
    figures: [figure({ point: 120 })],
  });
  await writeFilingCache(cacheDir, {
    cik: 2,
    ticker: "BBB",
    accession: "bbb-0",
    index: 0,
    items: ["5.02"],
    figures: undefined,
  });

  const run = await collectGuidanceEvents({ labelerVersion: version, cacheDir, items: ["2.02"] });

  assert.equal(run.filings_considered, 2);
  assert.equal(run.filings_labeled, 2);
  assert.equal(run.filings_with_guidance, 2);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].event_kind, "guidance_raise");
  assert.equal(run.events[0].ticker, "AAA");
});

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  db.prepare(
    "INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume) VALUES (?, 1, 'day', 0, 1, 1, 1, 1, 100)",
  ).run("AAA");
  return db;
}

test("collected guidance events insert and re-running is idempotent", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "sec8k-guidance-"));
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-0",
    index: 0,
    items: ["2.02"],
    figures: [figure({ point: 100 })],
  });
  await writeFilingCache(cacheDir, {
    cik: 1,
    ticker: "AAA",
    accession: "aaa-1",
    index: 1,
    items: ["2.02"],
    figures: [figure({ point: 120 })],
  });

  const db = makeDb();
  const run = await collectGuidanceEvents({ labelerVersion: version, cacheDir });
  const first = insertEvents(db, run.events);
  assert.equal(first.inserted, 1);

  const second = insertEvents(db, run.events);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 1);

  const stored = getEvents(db, { kind: "guidance_raise" });
  assert.equal(stored.length, 1);
  assert.equal((stored[0].payload as GuidanceRevisionPayload).labeler_version, version);
});
