import assert from "node:assert/strict";
import test from "node:test";

import { mergeRanges, subtractRanges } from "../src/services/coverage.ts";

test("mergeRanges combines overlapping and adjacent ranges", () => {
  assert.deepEqual(mergeRanges([[10, 20], [1, 4], [5, 9], [30, 35]]), [
    [1, 20],
    [30, 35],
  ]);
});

test("subtractRanges returns only uncovered gaps", () => {
  assert.deepEqual(subtractRanges(1, 100, [[10, 20], [30, 40], [35, 50]]), [
    [1, 9],
    [21, 29],
    [51, 100],
  ]);
});

test("subtractRanges returns empty when fully covered", () => {
  assert.deepEqual(subtractRanges(10, 20, [[1, 50]]), []);
});
