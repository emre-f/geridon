import assert from "node:assert/strict";
import test from "node:test";

import type { EventStudyPoint, EventStudyResult } from "../src/services/signalEval/eventStudy.ts";
import { summarizeHorizons } from "../src/services/signalEval/horizonSummary.ts";

function makeStudy(gaps: Array<number | null>): EventStudyResult {
  const curve: EventStudyPoint[] = gaps.map((gap, index) => ({
    horizon: index + 1,
    signal_mean: gap,
    signal_events: gap == null ? 0 : 100,
    baseline_mean: gap == null ? null : 0,
    baseline_events: gap == null ? 0 : 100,
    gap,
    gap_lower: gap,
    gap_upper: gap,
  }));
  return {
    n_events: 100,
    n_tickers: 10,
    seed: 1,
    bootstrap_iterations: 20,
    events_per_year: [],
    curve,
  };
}

test("reports abnormal return at the standard horizons and the gap peak", () => {
  const gaps = Array.from({ length: 63 }, (_, index) => 0.001 * Math.min(index + 1, 21));
  const summary = summarizeHorizons(makeStudy(gaps));

  assert.deepEqual(
    summary.rows.map((row) => [row.horizon, row.abnormal]),
    [
      [1, 0.001],
      [5, 0.005],
      [10, 0.01],
      [21, 0.021],
      [63, 0.021],
    ],
  );
  assert.equal(summary.natural_holding_period_bars, 21);
  assert.equal(summary.peak_gap, 0.021);
});

test("a gap that never goes positive has no holding period", () => {
  const gaps = Array.from({ length: 63 }, (_, index) => -0.001 * (index + 1));
  const summary = summarizeHorizons(makeStudy(gaps));

  assert.equal(summary.natural_holding_period_bars, null);
  assert.equal(summary.peak_gap, -0.001);
});

test("horizons beyond the study curve come back null", () => {
  const summary = summarizeHorizons(makeStudy([0.001, 0.002, 0.003, 0.004, 0.005]));

  const beyond = summary.rows.filter((row) => row.horizon > 5);
  assert.equal(beyond.length, 3);
  for (const row of beyond) {
    assert.equal(row.signal_mean, null);
    assert.equal(row.baseline_mean, null);
    assert.equal(row.abnormal, null);
  }
  assert.equal(summary.natural_holding_period_bars, 5);
});

test("an all-null curve has no peak and no holding period", () => {
  const summary = summarizeHorizons(makeStudy([null, null, null]));

  assert.equal(summary.peak_gap, null);
  assert.equal(summary.natural_holding_period_bars, null);
  assert.ok(summary.rows.every((row) => row.abnormal == null));
});
