import assert from "node:assert/strict";
import test from "node:test";

import type { ParameterStabilityEntry, SearchSpaceNode } from "@/lib/api-optimization-types";
import { stabilityRows } from "./optimize-stability-utils.ts";

const space: SearchSpaceNode[] = [
  {
    id: "entry.right.value",
    kind: "numeric",
    path: ["entry", "right", "value"],
    valueType: "decimal",
    min: 80,
    max: 120,
    step: 0.5,
    scale: "linear",
    current: 95,
  },
];

function entry(overrides: Partial<ParameterStabilityEntry>): ParameterStabilityEntry {
  return {
    nodeId: "entry.right.value",
    bestValue: 95,
    bestScore: 1.2,
    neighborCount: 5,
    neighborScoreMedian: 0.9,
    neighborScoreMin: 0.4,
    ...overrides,
  };
}

test("a neighborhood whose median beats the baseline reads as a robust region", () => {
  const rows = stabilityRows([entry({})], space, 0.5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "robust");
  assert.equal(rows[0].label, "entry threshold");
  assert.equal(rows[0].bestValue, 95);
});

test("a neighborhood that falls back to the baseline or below reads as a spike", () => {
  const rows = stabilityRows([entry({ neighborScoreMedian: 0.2 })], space, 0.5);
  assert.equal(rows[0].verdict, "spiky");
});

test("fewer than three neighbors is sparse evidence, not a verdict", () => {
  const rows = stabilityRows(
    [entry({ neighborCount: 2 }), entry({ neighborCount: 0, neighborScoreMedian: null })],
    space,
    0.5,
  );
  assert.equal(rows[0].verdict, "sparse");
  assert.equal(rows[1].verdict, "sparse");
});

test("without a baseline score any populated neighborhood counts as robust", () => {
  const rows = stabilityRows([entry({})], space, null);
  assert.equal(rows[0].verdict, "robust");
});

test("unknown node ids fall back to the raw id as label", () => {
  const rows = stabilityRows([entry({ nodeId: "exit.right.value" })], space, 0.5);
  assert.equal(rows[0].label, "exit.right.value");
});
