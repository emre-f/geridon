import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pairGuidanceEvents,
  pairingWindowMs,
  type EarningsAnchor,
} from "../src/services/sec/eightKGuidancePairing.ts";
import type { GuidanceEventKind } from "../src/services/sec/eightKGuidanceEvents.ts";
import type { EventRecord, GuidanceRevisionPayload } from "../src/types/events.ts";

const hourMs = 60 * 60 * 1000;
const baseTs = Date.UTC(2024, 3, 25, 21, 30);

function guidanceEvent(
  ticker: string,
  eventTsMs: number,
  kind: GuidanceEventKind = "guidance_raise",
): EventRecord<GuidanceEventKind> {
  const payload: GuidanceRevisionPayload = {
    cik: 1,
    accession: "0001-24-000001",
    prior_accession: "0001-24-000000",
    new_figure: { metric: "revenue", period: "FY 2024", unit: "USD billions", low: null, high: null, point: 2 },
    prior_figure: { metric: "revenue", period: "FY 2024", unit: "USD billions", low: null, high: null, point: 1 },
    new_midpoint: 2,
    prior_midpoint: 1,
    revision_pct: 1,
    withdrawn: false,
    labeler_version: "test-version",
    paired_beat: 0,
    paired_miss: 0,
    paired_surprise: null,
  };
  return {
    source: "sec_8k",
    ticker,
    event_kind: kind,
    event_ts_ms: eventTsMs,
    available_ts_ms: eventTsMs,
    score: 1,
    payload,
    dedupe_key: `test|${ticker}|${eventTsMs}|${kind}`,
  };
}

function anchors(entries: Array<[string, EarningsAnchor[]]>): Map<string, EarningsAnchor[]> {
  return new Map(entries);
}

test("pairs a same-release beat inside the window", () => {
  const event = guidanceEvent("AAPL", baseTs);
  const counts = pairGuidanceEvents(
    [event],
    anchors([["AAPL", [{ event_ts_ms: baseTs - 10 * hourMs, beat: true, score: 0.004 }]]]),
  );
  assert.deepEqual(counts, { paired_beat: 1, paired_miss: 0, unpaired: 0 });
  assert.equal(event.payload.paired_beat, 1);
  assert.equal(event.payload.paired_miss, 0);
  assert.equal(event.payload.paired_surprise, 0.004);
});

test("pairs a miss and keeps the flags exclusive", () => {
  const event = guidanceEvent("AAPL", baseTs, "guidance_cut");
  const counts = pairGuidanceEvents(
    [event],
    anchors([["AAPL", [{ event_ts_ms: baseTs + 20 * hourMs, beat: false, score: -0.01 }]]]),
  );
  assert.deepEqual(counts, { paired_beat: 0, paired_miss: 1, unpaired: 0 });
  assert.equal(event.payload.paired_beat, 0);
  assert.equal(event.payload.paired_miss, 1);
  assert.equal(event.payload.paired_surprise, -0.01);
});

test("an anchor beyond the window leaves the event unpaired", () => {
  const event = guidanceEvent("AAPL", baseTs);
  const counts = pairGuidanceEvents(
    [event],
    anchors([["AAPL", [{ event_ts_ms: baseTs + pairingWindowMs + 1, beat: true, score: 0.2 }]]]),
  );
  assert.deepEqual(counts, { paired_beat: 0, paired_miss: 0, unpaired: 1 });
  assert.equal(event.payload.paired_beat, 0);
  assert.equal(event.payload.paired_miss, 0);
  assert.equal(event.payload.paired_surprise, null);
});

test("the nearest of two in-window anchors wins", () => {
  const event = guidanceEvent("AAPL", baseTs);
  pairGuidanceEvents(
    [event],
    anchors([
      [
        "AAPL",
        [
          { event_ts_ms: baseTs - 30 * hourMs, beat: false, score: -0.5 },
          { event_ts_ms: baseTs - 2 * hourMs, beat: true, score: 0.1 },
        ],
      ],
    ]),
  );
  assert.equal(event.payload.paired_beat, 1);
  assert.equal(event.payload.paired_surprise, 0.1);
});

test("a ticker with no earnings history stays unpaired", () => {
  const event = guidanceEvent("ZZZZ", baseTs);
  const counts = pairGuidanceEvents([event], anchors([]));
  assert.deepEqual(counts, { paired_beat: 0, paired_miss: 0, unpaired: 1 });
});
