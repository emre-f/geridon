import assert from "node:assert/strict";
import test from "node:test";

import type { OptimizationTrialRecord } from "@/lib/api-optimization-experiment-types";
import type { TrialScore } from "@/lib/api-optimization-types";
import {
  inChartOrder,
  inLeaderboardOrder,
  matchesTrialFilter,
  traceSeries,
} from "./optimize-detail-utils.ts";

function score(value: number, eligible = true): TrialScore {
  return {
    score: value,
    medianObjective: value,
    eligible,
    ineligibilityReasons: eligible ? [] : ["too few trades"],
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

test("matchesTrialFilter treats unknown eligibility as neither eligible nor ineligible", () => {
  const eligible = trial({ eligible: true });
  const ineligible = trial({ eligible: false });
  const pruned = trial({ status: "pruned", eligible: null });

  assert.equal(matchesTrialFilter(eligible, "eligible"), true);
  assert.equal(matchesTrialFilter(pruned, "eligible"), false);
  assert.equal(matchesTrialFilter(ineligible, "ineligible"), true);
  assert.equal(matchesTrialFilter(pruned, "ineligible"), false);
  assert.equal(matchesTrialFilter(pruned, "promoted"), false);
  assert.equal(matchesTrialFilter(eligible, "promoted"), true);
  assert.equal(matchesTrialFilter(pruned, "all"), true);
});

test("inChartOrder sorts by trial index without mutating the input", () => {
  const trials = [trial({ trial_index: 2 }), trial({ trial_index: 0 }), trial({ trial_index: 1 })];
  const ordered = inChartOrder(trials);

  assert.deepEqual(
    ordered.map((entry) => entry.trial_index),
    [0, 1, 2],
  );
  assert.equal(trials[0].trial_index, 2);
});

test("inLeaderboardOrder puts ranked trials first, then unranked by index", () => {
  const trials = [
    trial({ trial_index: 5, rank: null }),
    trial({ trial_index: 4, rank: 2 }),
    trial({ trial_index: 3, rank: null }),
    trial({ trial_index: 9, rank: 1 }),
  ];

  assert.deepEqual(
    inLeaderboardOrder(trials).map((entry) => entry.trial_index),
    [9, 4, 3, 5],
  );
});

test("traceSeries skips scoreless trials and tracks best-so-far over scored trials", () => {
  const trials = [
    trial({ trial_index: 0, score: score(-1.2) }),
    trial({ trial_index: 1, status: "rejected", score: null }),
    trial({ trial_index: 2, score: score(-0.8) }),
    trial({ trial_index: 3, score: score(-1.5, false) }),
  ];

  const points = traceSeries(trials);
  assert.deepEqual(
    points.map((point) => point.trialIndex),
    [0, 2, 3],
  );
  assert.deepEqual(
    points.map((point) => point.bestSoFar),
    [-1.2, -0.8, -0.8],
  );
  assert.equal(points[2].eligible, false);
});

test("traceSeries plots pruned scores without advancing the best-so-far line", () => {
  const trials = [
    trial({ trial_index: 0, score: score(-1.0) }),
    trial({ trial_index: 1, status: "pruned", score: score(0.5) }),
    trial({ trial_index: 2, score: score(-0.6) }),
  ];

  const points = traceSeries(trials);
  assert.deepEqual(
    points.map((point) => point.bestSoFar),
    [-1.0, -1.0, -0.6],
  );
  assert.equal(points[1].status, "pruned");
});
