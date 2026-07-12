import assert from "node:assert/strict";
import test from "node:test";

import type { TrialEquityResponse } from "@/lib/api-optimization-experiment-types";
import type { AblationEntry, SearchSpaceNode, TrialScore } from "@/lib/api-optimization-types";
import {
  ablationRows,
  candidateDiff,
  equityChartData,
  ruleLabel,
} from "./optimize-candidate-utils.ts";

const space: SearchSpaceNode[] = [
  {
    id: "entry.conditions.0.left.params.fast",
    kind: "numeric",
    path: ["entry", "conditions", "0", "left", "params", "fast"],
    valueType: "integer",
    min: 4,
    max: 24,
    step: 1,
    scale: "linear",
    current: 12,
  },
  {
    id: "entry.right.value",
    kind: "categorical",
    path: ["entry", "right", "value"],
    choices: [90, 95, 100],
    current: 95,
  },
  {
    id: "exit.conditions.1.enabled",
    kind: "toggle",
    path: ["exit", "conditions", "1", "enabled"],
    current: true,
  },
];

test("candidateDiff lists only values that differ from the baseline", () => {
  const rows = candidateDiff(space, {
    "entry.conditions.0.left.params.fast": 8,
    "entry.right.value": 95,
    "exit.conditions.1.enabled": false,
  });
  assert.deepEqual(
    rows.map((row) => [row.label, row.from, row.to]),
    [
      ["entry r1 fast", "12", "8"],
      ["exit r2 enabled", "on", "off"],
    ],
  );
});

test("candidateDiff ignores nodes the trial never sampled", () => {
  assert.deepEqual(candidateDiff(space, {}), []);
});

test("ruleLabel compresses dotted rule paths", () => {
  assert.equal(ruleLabel("entry"), "entry");
  assert.equal(ruleLabel("entry.conditions.0"), "entry r1");
  assert.equal(ruleLabel("exit.conditions.1.conditions.0"), "exit r2.1");
});

function ablationScore(value: number): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible: true,
    ineligibilityReasons: [],
    penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
  };
}

test("ablationRows splits bars from skipped entries and sorts by delta", () => {
  const entries: AblationEntry[] = [
    {
      ruleId: "entry.conditions.0",
      summary: "entry: close lt 95",
      skipped: false,
      score: ablationScore(0.4),
      scoreDelta: -0.6,
    },
    {
      ruleId: "exit",
      summary: "exit: close gt 105",
      skipped: true,
      skipReason: "The strategy needs at least one active exit rule.",
      score: null,
      scoreDelta: null,
    },
    {
      ruleId: "entry.conditions.1",
      summary: "entry: volume gt 1000",
      skipped: false,
      score: ablationScore(1.2),
      scoreDelta: 0.2,
    },
  ];

  const { bars, skipped } = ablationRows(entries);
  assert.deepEqual(
    bars.map((bar) => [bar.label, bar.delta]),
    [
      ["entry r2", 0.2],
      ["entry r1", -0.6],
    ],
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].ruleId, "exit");
});

test("equityChartData converts equity to percent return grouped by symbol and fold", () => {
  const response: TrialEquityResponse = {
    trial_index: 3,
    initial_capital: 10_000,
    candidate: [
      {
        symbol: "TEST",
        foldIndex: 1,
        points: [
          { timestamp_ms: 200, equity: 10_000 },
          { timestamp_ms: 300, equity: 11_000 },
        ],
      },
      {
        symbol: "TEST",
        foldIndex: 0,
        points: [{ timestamp_ms: 100, equity: 9_500 }],
      },
    ],
    baseline: [
      {
        symbol: "TEST",
        foldIndex: 0,
        points: [{ timestamp_ms: 100, equity: 10_000 }],
      },
    ],
  };

  const data = equityChartData(response);
  assert.equal(data.length, 1);
  assert.equal(data[0].symbol, "TEST");
  assert.deepEqual(
    data[0].folds.map((fold) => fold.foldIndex),
    [0, 1],
  );
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
  assert.deepEqual(
    data[0].folds[1].candidate.map((point) => point.timestamp_ms),
    [200, 300],
  );
  near(data[0].folds[1].candidate[0].returnPct, 0);
  near(data[0].folds[1].candidate[1].returnPct, 10);
  assert.deepEqual(data[0].folds[0].baseline, [{ timestamp_ms: 100, returnPct: 0 }]);
  near(data[0].folds[0].candidate[0].returnPct, -5);
  assert.deepEqual(data[0].folds[1].baseline, []);
});
