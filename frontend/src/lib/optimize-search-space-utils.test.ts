import assert from "node:assert/strict";
import { test } from "node:test";

import type { SearchSpacePreview } from "@/lib/api-optimization-experiment-types";
import {
  buildParameterOverrides,
  buildRuleRoles,
  editsIssue,
  editsSummary,
  initialEdits,
  ruleParameterGroups,
  searchedNodes,
} from "./optimize-search-space-utils.ts";

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
        kind: "numeric",
        path: ["entry", "conditions", "1", "right", "value"],
        valueType: "decimal",
        min: 32.5,
        max: 97.5,
        step: 2,
        scale: "linear",
        current: 65,
        hard_min: null,
        hard_max: null,
      },
    ],
  };
}

test("initial edits keep every rule required and every parameter tuned", () => {
  const edits = initialEdits(preview());
  assert.deepEqual(Object.values(edits.roles), ["required", "required", "required"]);
  assert.equal(buildRuleRoles(edits), undefined);
  assert.equal(buildParameterOverrides(preview(), edits), undefined);
  assert.equal(editsIssue(preview(), edits), null);
  assert.equal(editsSummary(preview(), edits), "2 of 2 parameters searched");
});

test("only deviations from the defaults are sent to the API", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.roles["entry.conditions.1"] = "optional";
  edits.parameters["entry.conditions.0.left.parameters.fast"] = { locked: true, min: 6, max: 18 };
  edits.parameters["entry.conditions.1.right.value"] = { locked: false, min: 40, max: 97.5 };

  assert.deepEqual(buildRuleRoles(edits), { "entry.conditions.1": "optional" });
  assert.deepEqual(buildParameterOverrides(data, edits), {
    "entry.conditions.0.left.parameters.fast": { locked: true },
    "entry.conditions.1.right.value": { min: 40, max: 97.5 },
  });
  assert.equal(editsSummary(data, edits), "1 of 2 parameters searched · 1 optional rule");
});

test("nodes under an off rule are not counted as searched", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.roles["entry.conditions.1"] = "off";
  assert.deepEqual(
    searchedNodes(data, edits).map((node) => node.id),
    ["entry.conditions.0.left.parameters.fast"],
  );
  assert.equal(editsSummary(data, edits), "1 of 2 parameters searched · 1 rule off");
});

test("ruleParameterGroups nests each parameter under its rule and keeps leftovers", () => {
  const data = preview();
  data.nodes.push({
    id: "sizing.value",
    kind: "numeric",
    path: ["sizing", "value"],
    valueType: "integer",
    min: 1,
    max: 10,
    step: 1,
    scale: "linear",
    current: 5,
    hard_min: null,
    hard_max: null,
  });

  const groups = ruleParameterGroups(data);
  assert.deepEqual(
    groups.map((group) => [group.rule?.id ?? null, group.nodes.map((node) => node.id)]),
    [
      ["entry.conditions.0", ["entry.conditions.0.left.parameters.fast"]],
      ["entry.conditions.1", ["entry.conditions.1.right.value"]],
      ["exit", []],
      [null, ["sizing.value"]],
    ],
  );
});

test("turning every rule of one side off is an issue", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.roles["entry.conditions.0"] = "off";
  edits.roles["entry.conditions.1"] = "off";
  assert.match(editsIssue(data, edits)!, /entry rule must stay on/);
});

test("inverted ranges and out-of-bounds ranges are issues", () => {
  const data = preview();
  const edits = initialEdits(data);
  edits.parameters["entry.conditions.0.left.parameters.fast"] = { locked: false, min: 18, max: 6 };
  assert.match(editsIssue(data, edits)!, /min below max/);

  edits.parameters["entry.conditions.0.left.parameters.fast"] = { locked: false, min: 0, max: 18 };
  assert.match(editsIssue(data, edits)!, /within 1–500/);
});

test("locking everything with no optional rules is an issue", () => {
  const data = preview();
  const edits = initialEdits(data);
  for (const id of Object.keys(edits.parameters)) {
    edits.parameters[id] = { ...edits.parameters[id], locked: true };
  }
  assert.match(editsIssue(data, edits)!, /nothing left to search/);

  edits.roles["entry.conditions.1"] = "optional";
  assert.equal(editsIssue(data, edits), null);
});
