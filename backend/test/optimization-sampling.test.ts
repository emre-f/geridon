import assert from "node:assert/strict";
import { test } from "node:test";

import { SeededRandom } from "../src/services/optimization/random.ts";
import { applyValues, sampleNumeric, sampleValues } from "../src/services/optimization/sampler.ts";
import { buildFolds, spreadFoldSubset } from "../src/services/optimization/folds.ts";
import { thresholdStrategy } from "./optimizationFixtures.ts";
import type { NumericSearchNode, SearchSpaceNode } from "../src/types.ts";

const periodNode: NumericSearchNode = {
  id: "entry.left.parameters.period",
  kind: "numeric",
  path: ["entry", "left", "parameters", "period"],
  valueType: "integer",
  min: 5,
  max: 200,
  step: 1,
  scale: "log",
  current: 20,
};

test("same seed produces the same sample sequence", () => {
  const nodes: SearchSpaceNode[] = [
    periodNode,
    { id: "toggle", kind: "toggle", path: ["entry", "enabled"], current: true },
    { id: "choice", kind: "categorical", path: ["exit", "right", "value"], choices: [1, 2, 3], current: 1 },
  ];
  const rngA = new SeededRandom(7);
  const rngB = new SeededRandom(7);
  const runA = Array.from({ length: 5 }, () => sampleValues(nodes, rngA));
  const runB = Array.from({ length: 5 }, () => sampleValues(nodes, rngB));
  assert.deepEqual(runA, runB);
});

test("numeric samples respect bounds, steps, and integer type", () => {
  const random = new SeededRandom(123);
  for (let i = 0; i < 500; i += 1) {
    const value = sampleNumeric(periodNode, random);
    assert.ok(value >= periodNode.min && value <= periodNode.max);
    assert.ok(Number.isInteger(value));
  }
});

test("applyValues writes deep paths without mutating the base strategy", () => {
  const base = thresholdStrategy(95, 105);
  const node: SearchSpaceNode = {
    id: "entry.right.value",
    kind: "numeric",
    path: ["entry", "right", "value"],
    valueType: "decimal",
    min: 90,
    max: 100,
    step: 0.5,
    scale: "linear",
    current: 95,
  };
  const candidate = applyValues(base, [node], { "entry.right.value": 92.5 });
  assert.ok(base.entry.type === "rule" && base.entry.right.type === "value");
  assert.equal(base.entry.right.value, 95);
  assert.ok(candidate.entry.type === "rule" && candidate.entry.right.type === "value");
  assert.equal(candidate.entry.right.value, 92.5);
});

test("anchored folds are chronological, contiguous, and non-overlapping", () => {
  const folds = buildFolds(400, { foldCount: 4, mode: "anchored" });
  assert.equal(folds.length, 4);
  for (const fold of folds) {
    assert.equal(fold.trainStartIndex, 0);
    assert.equal(fold.trainEndIndex, fold.validStartIndex - 1);
    assert.ok(fold.validStartIndex <= fold.validEndIndex);
  }
  for (let i = 1; i < folds.length; i += 1) {
    assert.equal(folds[i].validStartIndex, folds[i - 1].validEndIndex + 1);
  }
  assert.equal(folds.at(-1)!.validEndIndex, 399);
});

test("rolling folds keep a fixed-length training window", () => {
  const folds = buildFolds(400, { foldCount: 4, mode: "rolling" });
  const lengths = folds.map((fold) => fold.trainEndIndex - fold.trainStartIndex + 1);
  assert.ok(lengths.every((length) => length === lengths[0]));
  assert.ok(folds[1].trainStartIndex > folds[0].trainStartIndex);
});

test("too few candles for the requested folds throws", () => {
  assert.throws(() => buildFolds(12, { foldCount: 5, mode: "anchored" }), /Not enough candles/);
});

test("an embargo leaves a gap between train end and validation start", () => {
  const embargo = 10;
  const plain = buildFolds(400, { foldCount: 4, mode: "anchored" });
  const embargoed = buildFolds(400, { foldCount: 4, mode: "anchored", embargoCandles: embargo });
  assert.equal(embargoed.length, plain.length);
  for (let i = 0; i < plain.length; i += 1) {
    assert.equal(embargoed[i].trainStartIndex, plain[i].trainStartIndex);
    assert.equal(embargoed[i].trainEndIndex, plain[i].trainEndIndex);
    assert.equal(embargoed[i].validStartIndex, plain[i].validStartIndex + embargo);
    assert.equal(embargoed[i].validEndIndex, plain[i].validEndIndex);
    assert.equal(embargoed[i].validStartIndex, embargoed[i].trainEndIndex + 1 + embargo);
  }
});

test("an embargo that starves validation windows throws", () => {
  assert.throws(
    () => buildFolds(400, { foldCount: 4, mode: "anchored", embargoCandles: 78 }),
    /embargo/,
  );
  assert.throws(
    () => buildFolds(400, { foldCount: 4, mode: "anchored", embargoCandles: 2.5 }),
    /non-negative integer/,
  );
});

test("spread fold subsets cover early and late regimes", () => {
  const folds = buildFolds(1000, { foldCount: 9, mode: "anchored" });
  const subset = spreadFoldSubset(folds, 3);
  assert.equal(subset.length, 3);
  assert.equal(subset[0].index, 0);
  assert.equal(subset.at(-1)!.index, 8);
});
