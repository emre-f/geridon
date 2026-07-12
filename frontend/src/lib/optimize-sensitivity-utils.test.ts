import assert from "node:assert/strict";
import test from "node:test";

import type { OptimizationTrialRecord } from "@/lib/api-optimization-experiment-types";
import type { SearchSpaceNode, TrialScore } from "@/lib/api-optimization-types";
import { sensitivityPanels, sensitivityScoreDomain } from "./optimize-sensitivity-utils.ts";

function score(value: number, eligible = true): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible,
    ineligibilityReasons: [],
    penalties: { drawdown: 0, instability: 0, turnover: 0, complexity: 0 },
  };
}

function trial(overrides: Partial<OptimizationTrialRecord>): OptimizationTrialRecord {
  return {
    experiment_id: 1,
    trial_index: 0,
    hash: "hash",
    phase: "search",
    status: "scored",
    rejection_reason: null,
    stage_reached: 1,
    rank: null,
    eligible: null,
    score: null,
    values: {},
    complexity: { activeRules: 1, uniqueIndicators: 1, maxDepth: 1 },
    metrics: null,
    ...overrides,
  };
}

const numericNode: SearchSpaceNode = {
  id: "entry.right.value",
  kind: "numeric",
  path: ["entry", "right", "value"],
  valueType: "integer",
  min: 90,
  max: 100,
  step: 1,
  scale: "linear",
  current: 95,
};

const categoricalNode: SearchSpaceNode = {
  id: "exit.right.value",
  kind: "categorical",
  path: ["exit", "right", "value"],
  choices: [105, 107, 109],
  current: 105,
};

const toggleNode: SearchSpaceNode = {
  id: "entry.conditions.1.enabled",
  kind: "toggle",
  path: ["entry", "conditions", "1", "enabled"],
  current: true,
};

test("sensitivityPanels builds one panel per numeric and categorical node", () => {
  const trials = [
    trial({ trial_index: 0, score: score(1), values: { "entry.right.value": 92, "exit.right.value": 105 } }),
    trial({ trial_index: 1, score: score(2, false), values: { "entry.right.value": 96, "exit.right.value": 109 } }),
  ];

  const panels = sensitivityPanels([numericNode, categoricalNode, toggleNode], trials);
  assert.deepEqual(
    panels.map((panel) => panel.nodeId),
    ["entry.right.value", "exit.right.value"],
  );
  assert.deepEqual(
    panels[0].points.map((point) => [point.value, point.score, point.eligible]),
    [
      [92, 1, true],
      [96, 2, false],
    ],
  );
});

test("sensitivityPanels skips unscored trials and non-numeric sampled values", () => {
  const trials = [
    trial({ trial_index: 0, score: score(1), values: { "entry.right.value": 92 } }),
    trial({ trial_index: 1, status: "pruned", score: score(2), values: { "entry.right.value": 96 } }),
    trial({ trial_index: 2, score: score(3), values: { "entry.right.value": 98 } }),
    trial({ trial_index: 3, score: score(4), values: {} }),
  ];

  const panels = sensitivityPanels([numericNode], trials);
  assert.deepEqual(
    panels[0].points.map((point) => point.trialIndex),
    [0, 2],
  );
});

test("sensitivityPanels drops panels where every trial sampled the same value", () => {
  const trials = [
    trial({ trial_index: 0, score: score(1), values: { "entry.right.value": 92 } }),
    trial({ trial_index: 1, score: score(2), values: { "entry.right.value": 92 } }),
  ];

  assert.deepEqual(sensitivityPanels([numericNode], trials), []);
});

test("sensitivityPanels widens the x domain to cover samples outside the node range", () => {
  const trials = [
    trial({ trial_index: 0, score: score(1), values: { "entry.right.value": 85 } }),
    trial({ trial_index: 1, score: score(2), values: { "entry.right.value": 104 } }),
  ];

  const [panel] = sensitivityPanels([numericNode], trials);
  assert.deepEqual({ min: panel.min, max: panel.max, current: panel.current }, {
    min: 85,
    max: 104,
    current: 95,
  });
});

test("sensitivityScoreDomain spans every panel plus the baseline with padding", () => {
  const trials = [
    trial({ trial_index: 0, score: score(1), values: { "entry.right.value": 92 } }),
    trial({ trial_index: 1, score: score(3), values: { "entry.right.value": 96 } }),
  ];
  const panels = sensitivityPanels([numericNode], trials);

  const domain = sensitivityScoreDomain(panels, -1);
  assert.ok(domain);
  assert.ok(domain.min < -1);
  assert.ok(domain.max > 3);

  assert.equal(sensitivityScoreDomain([], null), null);
});
