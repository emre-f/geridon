import assert from "node:assert/strict";
import test from "node:test";

import { anchorEvents } from "../src/services/eventAnchor.ts";
import { computeForwardReturns, type CloseBar } from "../src/services/forwardReturns.ts";

const dayMs = 24 * 60 * 60 * 1000;
const baseMs = Date.parse("2024-01-01T14:30:00.000Z");
const hourMs = 60 * 60 * 1000;

const eventDays = [5, 12, 19];
const jumpSize = 0.1;

function barTs(day: number): number {
  return baseMs + day * dayMs;
}

function buildBars(days: number, jumpDays: number[]): CloseBar[] {
  const bars: CloseBar[] = [];
  let close = 100;
  for (let day = 0; day < days; day += 1) {
    if (jumpDays.includes(day)) {
      close *= 1 + jumpSize;
    }
    bars.push({ timestamp_ms: barTs(day), close });
  }
  return bars;
}

function meanForwardReturn(
  availableTimestampsMs: number[],
  bars: CloseBar[],
  horizon: number,
): number {
  const rows = computeForwardReturns({ bars, horizons: [horizon] });
  const rawByTimestamp = new Map(rows.map((row) => [row.timestamp_ms, row.raw]));
  const anchors = anchorEvents(
    availableTimestampsMs,
    bars.map((bar) => bar.timestamp_ms),
  );

  const returns: number[] = [];
  for (const anchor of anchors) {
    assert.ok(anchor, "fixture event fell outside bar coverage");
    const raw = rawByTimestamp.get(anchor.anchor_timestamp_ms);
    assert.ok(raw != null, "fixture event has no forward return at its anchor");
    returns.push(raw);
  }
  return returns.reduce((sum, value) => sum + value, 0) / returns.length;
}

test("using event_ts instead of available_ts fabricates returns the real convention kills", () => {
  const bars = buildBars(30, eventDays.map((day) => day + 2));
  const eventTs = eventDays.map((day) => barTs(day) + hourMs);
  const availableTs = eventDays.map((day) => barTs(day + 2) + 6 * hourMs);

  for (const horizon of [1, 5]) {
    const lookahead = meanForwardReturn(eventTs, bars, horizon);
    const honest = meanForwardReturn(availableTs, bars, horizon);
    assert.ok(
      Math.abs(lookahead - jumpSize) < 1e-12,
      `event_ts anchoring must capture the pre-publication jump at horizon ${horizon}`,
    );
    assert.ok(
      Math.abs(honest) < 1e-12,
      `available_ts anchoring must see nothing at horizon ${horizon}`,
    );
  }
});

test("shifting all events one bar later kills a planted signal", () => {
  const bars = buildBars(30, eventDays.map((day) => day + 2));
  const availableTs = eventDays.map((day) => barTs(day) + 2 * hourMs);
  const shiftedTs = availableTs.map((ts) => ts + dayMs);

  const planted = meanForwardReturn(availableTs, bars, 1);
  const shifted = meanForwardReturn(shiftedTs, bars, 1);

  assert.ok(Math.abs(planted - jumpSize) < 1e-12, "planted signal must be visible on time");
  assert.ok(Math.abs(shifted) < 1e-12, "entering one bar late must miss the entire signal");
});
