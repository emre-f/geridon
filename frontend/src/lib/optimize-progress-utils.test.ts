import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  OptimizationExperimentListItem,
  OptimizationExperimentProgress,
} from "@/lib/api-optimization-experiment-types";
import { experimentProgressView } from "./optimize-progress-utils.ts";

function listItem(
  overrides: Partial<OptimizationExperimentListItem> = {},
): OptimizationExperimentListItem {
  return {
    id: 1,
    status: "running",
    strategy_id: 2,
    strategy_name: "MACD",
    tickers: ["AAPL"],
    timeframe: "1d",
    method: "random",
    max_trials: 100,
    max_runtime_ms: 120_000,
    progress: null,
    created_at: "2026-07-13 10:00:00",
    updated_at: "2026-07-13 10:00:00",
    ...overrides,
  };
}

function progress(
  overrides: Partial<OptimizationExperimentProgress> = {},
): OptimizationExperimentProgress {
  return {
    evaluated_trials: 40,
    max_trials: 100,
    updated_at_ms: 30_000,
    started_at_ms: 10_000,
    scored: 25,
    pruned: 10,
    rejected: 5,
    phase: "search",
    baseline_score: 0.42,
    ...overrides,
  };
}

test("a queued experiment shows the queued stage with nothing evaluated", () => {
  const view = experimentProgressView(listItem({ status: "queued" }), 50_000);
  assert.equal(view.stageLabel, "Queued");
  assert.equal(view.evaluated, 0);
  assert.equal(view.fraction, 0);
  assert.equal(view.trialsRemaining, 100);
  assert.equal(view.counts, null);
  assert.equal(view.elapsedMs, null);
  assert.equal(view.runtimeRemainingMs, null);
  assert.equal(view.baselineScore, null);
});

test("a running experiment without progress yet is starting", () => {
  const view = experimentProgressView(listItem(), 50_000);
  assert.equal(view.stageLabel, "Starting");
  assert.equal(view.counts, null);
  assert.equal(view.elapsedMs, null);
});

test("a running experiment derives counts, elapsed time, and remaining budget", () => {
  const view = experimentProgressView(listItem({ progress: progress() }), 50_000);
  assert.equal(view.stageLabel, "Searching");
  assert.equal(view.evaluated, 40);
  assert.equal(view.fraction, 0.4);
  assert.equal(view.trialsRemaining, 60);
  assert.deepEqual(view.counts, { scored: 25, pruned: 10, rejected: 5 });
  assert.equal(view.elapsedMs, 40_000);
  assert.equal(view.runtimeRemainingMs, 80_000);
  assert.equal(view.baselineScore, 0.42);
});

test("the refine phase gets its own stage label", () => {
  const view = experimentProgressView(
    listItem({ progress: progress({ phase: "refine" }) }),
    50_000,
  );
  assert.equal(view.stageLabel, "Refining around the best candidates");
});

test("legacy progress without counts still reports evaluated trials", () => {
  const legacy: OptimizationExperimentProgress = {
    evaluated_trials: 70,
    max_trials: 100,
    updated_at_ms: 30_000,
  };
  const view = experimentProgressView(listItem({ progress: legacy }), 50_000);
  assert.equal(view.stageLabel, "Searching");
  assert.equal(view.evaluated, 70);
  assert.equal(view.counts, null);
  assert.equal(view.elapsedMs, null);
  assert.equal(view.baselineScore, null);
});

test("an exhausted runtime budget clamps to zero and evaluated clamps to max trials", () => {
  const view = experimentProgressView(
    listItem({ progress: progress({ evaluated_trials: 120 }) }),
    400_000,
  );
  assert.equal(view.evaluated, 100);
  assert.equal(view.fraction, 1);
  assert.equal(view.trialsRemaining, 0);
  assert.equal(view.runtimeRemainingMs, 0);
});
