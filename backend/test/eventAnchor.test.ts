import assert from "node:assert/strict";
import test from "node:test";

import { anchorEvent, anchorEvents } from "../src/services/eventAnchor.ts";

const wednesdayOpen = Date.parse("2024-01-03T14:30:00.000Z");
const thursdayOpen = Date.parse("2024-01-04T14:30:00.000Z");
const fridayOpen = Date.parse("2024-01-05T14:30:00.000Z");
const mondayOpen = Date.parse("2024-01-08T14:30:00.000Z");
const tuesdayOpen = Date.parse("2024-01-09T14:30:00.000Z");
const bars = [wednesdayOpen, thursdayOpen, fridayOpen, mondayOpen, tuesdayOpen];

test("Friday-evening filing anchors to Friday and is actionable Monday", () => {
  const fridayEvening = Date.parse("2024-01-05T22:05:00.000Z");
  assert.deepEqual(anchorEvent(fridayEvening, bars), {
    anchor_index: 2,
    anchor_timestamp_ms: fridayOpen,
    actionable_timestamp_ms: mondayOpen,
  });
});

test("weekend availability rolls forward to Monday", () => {
  const saturdayNoon = Date.parse("2024-01-06T12:00:00.000Z");
  assert.deepEqual(anchorEvent(saturdayNoon, bars), {
    anchor_index: 2,
    anchor_timestamp_ms: fridayOpen,
    actionable_timestamp_ms: mondayOpen,
  });
});

test("intraday availability skips the full current bar", () => {
  const thursdayLunch = Date.parse("2024-01-04T17:00:00.000Z");
  assert.deepEqual(anchorEvent(thursdayLunch, bars), {
    anchor_index: 1,
    anchor_timestamp_ms: thursdayOpen,
    actionable_timestamp_ms: fridayOpen,
  });
});

test("availability exactly at a bar's timestamp anchors to that bar", () => {
  assert.deepEqual(anchorEvent(thursdayOpen, bars), {
    anchor_index: 1,
    anchor_timestamp_ms: thursdayOpen,
    actionable_timestamp_ms: fridayOpen,
  });
});

test("availability just before a bar's timestamp anchors to the prior bar", () => {
  assert.deepEqual(anchorEvent(thursdayOpen - 1, bars), {
    anchor_index: 0,
    anchor_timestamp_ms: wednesdayOpen,
    actionable_timestamp_ms: thursdayOpen,
  });
});

test("availability before the first bar has no anchor", () => {
  const beforeCoverage = Date.parse("2024-01-02T18:00:00.000Z");
  assert.equal(anchorEvent(beforeCoverage, bars), null);
});

test("availability at or after the last bar has no actionable bar yet", () => {
  const tuesdayEvening = Date.parse("2024-01-09T22:00:00.000Z");
  assert.deepEqual(anchorEvent(tuesdayEvening, bars), {
    anchor_index: 4,
    anchor_timestamp_ms: tuesdayOpen,
    actionable_timestamp_ms: null,
  });
});

test("anchorEvents maps many events and tolerates unsorted bars", () => {
  const shuffled = [fridayOpen, wednesdayOpen, tuesdayOpen, thursdayOpen, mondayOpen];
  const anchors = anchorEvents(
    [Date.parse("2024-01-02T00:00:00.000Z"), Date.parse("2024-01-06T12:00:00.000Z")],
    shuffled,
  );
  assert.deepEqual(anchors, [
    null,
    { anchor_index: 2,
    anchor_timestamp_ms: fridayOpen, actionable_timestamp_ms: mondayOpen },
  ]);
});
