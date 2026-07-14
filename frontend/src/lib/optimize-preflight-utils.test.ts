import assert from "node:assert/strict";
import { test } from "node:test";

import type { SearchSpacePreview } from "@/lib/api-optimization-experiment-types";
import { initialEdits } from "./optimize-search-space-utils.ts";
import {
  budgetPresets,
  formatCombinations,
  formatRuntime,
  numericCardinality,
  searchSpaceSize,
  spaceCoverageWarning,
} from "./optimize-preflight-utils.ts";

function preview(): SearchSpacePreview {
  return {
    strategy_id: 1,
    rules: [
      { id: "entry.conditions.0", side: "entry", summary: "macd cross_above signal", enabled: true },
      { id: "entry.conditions.1", side: "entry", summary: "rsi lt 65", enabled: true },
      { id: "exit", side: "exit", summary: "macd cross_below signal", enabled: true },
    ],
    nodes: [
      {
        id: "entry.conditions.0.left.parameters.fast",
        kind: "numeric",
        path: ["entry", "conditions", "0", "left", "parameters", "fast"],
        valueType: "integer",
        min: 6,
        max: 18,
        step: 1,
        scale: "linear",
        current: 12,
        hard_min: 1,
        hard_max: 500,
      },
      {
        id: "entry.conditions.1.right.value",
        kind: "categorical",
        path: ["entry", "conditions", "1", "right", "value"],
        choices: [55, 65, 75],
        current: 65,
        hard_min: null,
        hard_max: null,
      },
    ],
    sizing_nodes: [
      {
        id: "sizing.buyPercent",
        kind: "numeric",
        path: ["sizing", "buyPercent"],
        valueType: "integer",
        min: 50,
        max: 100,
        step: 5,
        scale: "linear",
        current: 100,
        hard_min: 1,
        hard_max: 100,
      },
    ],
    at_least_groups: [{ id: "entry", size: 3, count: 2 }],
  };
}

test("numericCardinality counts inclusive steps and survives float ranges", () => {
  assert.equal(numericCardinality(6, 18, 1), 13);
  assert.equal(numericCardinality(0.1, 0.3, 0.1), 3);
  assert.equal(numericCardinality(5, 5, 1), 1);
  assert.equal(numericCardinality(5, 4, 1), 1);
});

test("searchSpaceSize multiplies searched dimensions, sorted largest first", () => {
  const data = preview();
  const size = searchSpaceSize(data, initialEdits(data));
  assert.deepEqual(
    size.dimensions.map((dimension) => [dimension.label, dimension.cardinality]),
    [
      ["entry r1 fast", 13],
      ["entry r2 threshold", 3],
    ],
  );
  assert.ok(Math.abs(size.log10Total - Math.log10(39)) < 1e-9);
});

test("searchSpaceSize drops locked and off dimensions and adds optional rules", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.parameters["entry.conditions.0.left.parameters.fast"] = { locked: true, min: 6, max: 18 };
  edits.roles["entry.conditions.1"] = "optional";
  const size = searchSpaceSize(data, edits);
  assert.deepEqual(
    size.dimensions.map((dimension) => [dimension.label, dimension.cardinality]),
    [
      ["entry r2 threshold", 3],
      ["entry r2 on/off", 2],
    ],
  );

  edits.roles["entry.conditions.1"] = "off";
  const withOff = searchSpaceSize(data, edits);
  assert.deepEqual(withOff.dimensions, []);
  assert.equal(withOff.log10Total, 0);
});

test("edited numeric ranges change the cardinality", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.parameters["entry.conditions.0.left.parameters.fast"] = { locked: false, min: 10, max: 14 };
  const size = searchSpaceSize(data, edits);
  assert.equal(size.dimensions.find((d) => d.label === "entry r1 fast")?.cardinality, 5);
});

test("formatting helpers stay readable across magnitudes", () => {
  assert.equal(formatCombinations(0), "1");
  assert.equal(formatCombinations(Math.log10(39)), "39");
  assert.equal(formatCombinations(7.5), "3.2×10⁷");
  assert.equal(formatRuntime(400), "under 1s");
  assert.equal(formatRuntime(12_000), "12s");
  assert.equal(formatRuntime(200_000), "3.3min");
});

test("spaceCoverageWarning fires only when trials undersample the space", () => {
  const data = preview();
  const size = searchSpaceSize(data, initialEdits(data));
  assert.equal(spaceCoverageWarning(size, 100), null);

  const huge = { ...size, log10Total: 8 };
  const warning = spaceCoverageWarning(huge, 100);
  assert.ok(warning);
  assert.match(warning, /100 trials/);
});

test("budget presets scale from quick to thorough", () => {
  assert.ok(budgetPresets.quick.maxTrials < budgetPresets.standard.maxTrials);
  assert.ok(budgetPresets.standard.maxTrials < budgetPresets.thorough.maxTrials);
  assert.ok(budgetPresets.quick.foldCount <= budgetPresets.thorough.foldCount);
});

test("opted-in operators, at_least counts, and tuned sizing multiply the space", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.operators["entry.conditions.0"] = true;
  edits.atLeast.entry = true;
  edits.sizing["sizing.buyPercent"] = { tuned: true, min: 50, max: 100 };

  const size = searchSpaceSize(data, edits);
  assert.deepEqual(
    size.dimensions.map((dimension) => [dimension.label, dimension.cardinality]),
    [
      ["entry r1 fast", 13],
      ["buy %", 11],
      ["entry r1 operator", 6],
      ["entry r2 threshold", 3],
      ["entry at-least count", 3],
    ],
  );

  edits.roles["entry.conditions.0"] = "off";
  const withOff = searchSpaceSize(data, edits);
  assert.ok(
    withOff.dimensions.every((dimension) => dimension.id !== "entry.conditions.0.operator"),
    "operator search is dropped when its rule is off",
  );
});
