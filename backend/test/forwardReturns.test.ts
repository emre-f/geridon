import assert from "node:assert/strict";
import test from "node:test";

import {
  computeForwardReturns,
  forwardReturnHorizons,
  type CloseBar,
} from "../src/services/forwardReturns.ts";

const dayMs = 24 * 60 * 60 * 1000;
const baseMs = Date.parse("2024-01-01T00:00:00.000Z");

function bar(day: number, close: number): CloseBar {
  return { timestamp_ms: baseMs + day * dayMs, close };
}

function row(rows: ReturnType<typeof computeForwardReturns>, day: number, horizon: number) {
  const match = rows.find(
    (candidate) => candidate.timestamp_ms === baseMs + day * dayMs && candidate.horizon === horizon,
  );
  assert.ok(match, `missing row for day ${day} horizon ${horizon}`);
  return match;
}

test("raw forward return enters at t+1 and exits at t+1+k", () => {
  const bars = [bar(0, 100), bar(1, 100), bar(2, 110), bar(3, 121)];
  const rows = computeForwardReturns({ bars, horizons: [1, 2] });

  assert.ok(Math.abs(row(rows, 0, 1).raw! - 0.1) < 1e-12);
  assert.ok(Math.abs(row(rows, 0, 2).raw! - 0.21) < 1e-12);
  assert.ok(Math.abs(row(rows, 1, 1).raw! - 0.1) < 1e-12);
});

test("returns null where entry or exit bars are missing", () => {
  const bars = [bar(0, 100), bar(1, 110), bar(2, 121)];
  const rows = computeForwardReturns({ bars, horizons: [1, 5] });

  assert.equal(rows.length, bars.length * 2);
  assert.equal(row(rows, 0, 5).raw, null);
  assert.equal(row(rows, 1, 1).raw, null);
  assert.equal(row(rows, 2, 1).raw, null);
  assert.ok(row(rows, 0, 1).raw != null);
});

test("default horizons are 1, 5, 10, 21, 63", () => {
  const rows = computeForwardReturns({ bars: [bar(0, 100), bar(1, 100)] });
  assert.deepEqual(
    rows.map((r) => r.horizon),
    [...forwardReturnHorizons, ...forwardReturnHorizons],
  );
});

test("market adjustment subtracts the market return over the same window", () => {
  const bars = [bar(0, 100), bar(1, 100), bar(2, 110)];
  const marketBars = [bar(0, 400), bar(1, 400), bar(2, 420)];
  const rows = computeForwardReturns({ bars, marketBars, horizons: [1] });

  assert.ok(Math.abs(row(rows, 0, 1).market_adjusted! - (0.1 - 0.05)) < 1e-12);
});

test("market window follows the ticker's timestamps across gaps, not bar offsets", () => {
  const bars = [bar(1, 100), bar(2, 100), bar(4, 110), bar(5, 115)];
  const marketBars = [bar(1, 400), bar(2, 400), bar(3, 500), bar(4, 440), bar(5, 450)];
  const rows = computeForwardReturns({ bars, marketBars, horizons: [1] });

  const adjusted = row(rows, 1, 1).market_adjusted!;
  assert.ok(Math.abs(adjusted - (0.1 - 0.1)) < 1e-12);
});

test("missing market bar yields null adjustment but keeps the raw return", () => {
  const bars = [bar(0, 100), bar(1, 100), bar(2, 110)];
  const marketBars = [bar(0, 400), bar(1, 400)];
  const rows = computeForwardReturns({ bars, marketBars, horizons: [1] });

  const result = row(rows, 0, 1);
  assert.ok(Math.abs(result.raw! - 0.1) < 1e-12);
  assert.equal(result.market_adjusted, null);
});

test("unsorted input bars produce the same rows as sorted input", () => {
  const sorted = [bar(0, 100), bar(1, 105), bar(2, 110), bar(3, 121)];
  const shuffled = [sorted[2], sorted[0], sorted[3], sorted[1]];
  const marketBars = [bar(0, 400), bar(1, 405), bar(2, 410), bar(3, 420)];

  assert.deepEqual(
    computeForwardReturns({ bars: shuffled, marketBars, horizons: [1, 2] }),
    computeForwardReturns({ bars: sorted, marketBars, horizons: [1, 2] }),
  );
});
