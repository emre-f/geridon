import assert from "node:assert/strict";
import test from "node:test";

import type { CloseBar } from "../src/services/forwardReturns.ts";
import {
  runEventStudy,
  type StudyEvent,
} from "../src/services/signalEval/eventStudy.ts";

const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2020, 0, 1);
const barMs = (index: number) => firstBarMs + index * dayMs;

function bars(closes: number[]): CloseBar[] {
  return closes.map((close, index) => ({ timestamp_ms: barMs(index), close }));
}

function flatBars(count: number, close = 100): CloseBar[] {
  return bars(new Array<number>(count).fill(close));
}

const closeTo = (actual: number | null, expected: number, label: string) => {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-12, `${label}: ${actual}`);
};

test("signal curve is the mean cumulative market-adjusted return", () => {
  const tickerCloses = [100, 100, 110, 121, 133.1];
  const marketCloses = [200, 200, 210, 220.5, 231.525];
  const result = runEventStudy({
    events: [{ ticker: "AAA", anchor_timestamp_ms: barMs(0) }],
    barsByTicker: new Map([["AAA", bars(tickerCloses)]]),
    marketBars: bars(marketCloses),
    seed: 1,
    maxHorizon: 3,
    bootstrapIterations: 10,
  });

  assert.equal(result.n_events, 1);
  assert.equal(result.n_tickers, 1);
  for (let k = 1; k <= 3; k += 1) {
    const expected =
      tickerCloses[1 + k] / tickerCloses[1] - 1 - (marketCloses[1 + k] / marketCloses[1] - 1);
    const point = result.curve[k - 1];
    assert.equal(point.horizon, k);
    assert.equal(point.signal_events, 1);
    closeTo(point.signal_mean, expected, `horizon ${k}`);
  }
});

test("baseline samples the same ticker but never an event anchor date", () => {
  const result = runEventStudy({
    events: [{ ticker: "AAA", anchor_timestamp_ms: barMs(0) }],
    barsByTicker: new Map([["AAA", bars([100, 100, 150, 300, 600, 1200])]]),
    marketBars: flatBars(6),
    seed: 3,
    maxHorizon: 1,
    bootstrapIterations: 10,
  });

  const point = result.curve[0];
  closeTo(point.signal_mean, 0.5, "signal");
  assert.equal(point.baseline_mean, 1);
});

test("identical event curves collapse the bootstrap band onto the gap", () => {
  const tickers = ["T0", "T1", "T2"];
  const closes = [...new Array<number>(12).fill(100), 110];
  const result = runEventStudy({
    events: tickers.map((ticker) => ({ ticker, anchor_timestamp_ms: barMs(10) })),
    barsByTicker: new Map(tickers.map((ticker) => [ticker, bars(closes)])),
    marketBars: flatBars(13),
    seed: 7,
    maxHorizon: 1,
    bootstrapIterations: 50,
  });

  const point = result.curve[0];
  assert.equal(point.signal_events, 3);
  closeTo(point.signal_mean, 0.1, "signal");
  assert.equal(point.baseline_mean, 0);
  closeTo(point.gap, 0.1, "gap");
  assert.equal(point.gap_lower, point.gap);
  assert.equal(point.gap_upper, point.gap);
});

function variedScenario(): {
  events: StudyEvent[];
  barsByTicker: Map<string, CloseBar[]>;
  marketBars: CloseBar[];
} {
  const tickers = ["AAA", "BBB", "CCC", "DDD"];
  const barsByTicker = new Map(
    tickers.map((ticker, tickerIndex) => [
      ticker,
      bars(
        Array.from({ length: 25 }, (_, index) => 100 + ((index * 37 + tickerIndex * 13) % 50)),
      ),
    ]),
  );
  const events = tickers.flatMap((ticker) =>
    [3, 8, 14].map((index) => ({ ticker, anchor_timestamp_ms: barMs(index) })),
  );
  return { events, barsByTicker, marketBars: flatBars(25) };
}

test("same inputs and seed produce identical results; seeds change the baseline", () => {
  const scenario = variedScenario();
  const first = runEventStudy({ ...scenario, seed: 1, maxHorizon: 5, bootstrapIterations: 20 });
  const second = runEventStudy({ ...scenario, seed: 1, maxHorizon: 5, bootstrapIterations: 20 });
  assert.deepEqual(first, second);

  const otherSeed = runEventStudy({ ...scenario, seed: 2, maxHorizon: 5, bootstrapIterations: 20 });
  assert.notDeepEqual(first, otherSeed);
});

test("input event order does not change the result", () => {
  const scenario = variedScenario();
  const forward = runEventStudy({ ...scenario, seed: 5, maxHorizon: 5, bootstrapIterations: 20 });
  const reversed = runEventStudy({
    ...scenario,
    events: [...scenario.events].reverse(),
    seed: 5,
    maxHorizon: 5,
    bootstrapIterations: 20,
  });
  assert.deepEqual(forward, reversed);
});

test("missing bars truncate curves and drop event counts", () => {
  const result = runEventStudy({
    events: [{ ticker: "AAA", anchor_timestamp_ms: barMs(5) }],
    barsByTicker: new Map([["AAA", flatBars(10)]]),
    marketBars: flatBars(10),
    seed: 1,
    maxHorizon: 5,
    bootstrapIterations: 10,
  });

  for (const point of result.curve) {
    if (point.horizon <= 3) {
      assert.equal(point.signal_events, 1);
      assert.equal(point.signal_mean, 0);
    } else {
      assert.equal(point.signal_events, 0);
      assert.equal(point.signal_mean, null);
    }
  }
});

test("events per year fills gap years with zero", () => {
  const result = runEventStudy({
    events: [
      { ticker: "AAA", anchor_timestamp_ms: Date.UTC(2020, 5, 1) },
      { ticker: "BBB", anchor_timestamp_ms: Date.UTC(2022, 5, 1) },
    ],
    barsByTicker: new Map(),
    marketBars: [],
    seed: 1,
    maxHorizon: 1,
    bootstrapIterations: 5,
  });

  assert.deepEqual(result.events_per_year, [
    { year: 2020, count: 1 },
    { year: 2021, count: 0 },
    { year: 2022, count: 1 },
  ]);
});

test("empty event list yields an all-null curve", () => {
  const result = runEventStudy({
    events: [],
    barsByTicker: new Map(),
    marketBars: [],
    seed: 1,
    maxHorizon: 2,
    bootstrapIterations: 5,
  });

  assert.equal(result.n_events, 0);
  assert.equal(result.n_tickers, 0);
  assert.deepEqual(result.events_per_year, []);
  for (const point of result.curve) {
    assert.equal(point.signal_mean, null);
    assert.equal(point.baseline_mean, null);
    assert.equal(point.gap, null);
    assert.equal(point.gap_lower, null);
    assert.equal(point.gap_upper, null);
  }
});
