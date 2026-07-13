import assert from "node:assert/strict";
import { test } from "node:test";

import { handleListExperiments } from "../src/api/optimizationExperiments.ts";
import { priceAdjustmentNote } from "../src/api/optimizationRequests.ts";
import { ProgressTracker } from "../src/services/optimization/progressTracker.ts";
import type { OptimizationExperimentListItem } from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";

test("progress tracker accumulates counts, phase, and baseline", () => {
  const tracker = new ProgressTracker(10, 1_000);

  const initial = tracker.snapshot(1_000);
  assert.equal(initial.evaluated_trials, 0);
  assert.equal(initial.max_trials, 10);
  assert.equal(initial.started_at_ms, 1_000);
  assert.equal(initial.phase, "search");
  assert.equal(initial.baseline_score, null);

  tracker.recordBaseline(0.42);
  tracker.recordTrial({ status: "scored", phase: "search" });
  tracker.recordTrial({ status: "pruned", phase: "search" });
  tracker.recordTrial({ status: "rejected", phase: "search" });
  tracker.recordTrial({ status: "scored", phase: "refine" });

  const snapshot = tracker.snapshot(5_000);
  assert.equal(snapshot.evaluated_trials, 4);
  assert.equal(snapshot.scored, 2);
  assert.equal(snapshot.pruned, 1);
  assert.equal(snapshot.rejected, 1);
  assert.equal(snapshot.phase, "refine");
  assert.equal(snapshot.baseline_score, 0.42);
  assert.equal(snapshot.updated_at_ms, 5_000);
  assert.equal(snapshot.started_at_ms, 1_000);
});

test("a finished experiment persists enriched progress and provenance", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const startedBeforeMs = Date.now();
  const experiment = await runToCompletion(db, runner, experimentBody(strategyId));
  assert.equal(experiment.status, "completed");

  const progress = experiment.progress;
  assert.ok(progress);
  assert.equal(progress.evaluated_trials, experiment.config.max_trials);
  assert.equal(
    (progress.scored ?? 0) + (progress.pruned ?? 0) + (progress.rejected ?? 0),
    progress.evaluated_trials,
  );
  assert.equal(progress.scored, experiment.summary?.trial_counts.scored);
  assert.equal(progress.pruned, experiment.summary?.trial_counts.pruned);
  assert.equal(progress.rejected, experiment.summary?.trial_counts.rejected);
  assert.equal(progress.baseline_score, experiment.summary?.baseline.score.score);
  assert.ok(progress.phase === "search" || progress.phase === "refine");
  assert.ok(progress.started_at_ms != null && progress.started_at_ms >= startedBeforeMs);
  assert.ok(progress.started_at_ms <= progress.updated_at_ms);

  assert.equal(experiment.snapshot.price_adjustment, priceAdjustmentNote);
  assert.deepEqual(experiment.snapshot.datasets[0].sources, ["polygon"]);

  const listed = handleListExperiments(db, new URLSearchParams());
  const item = (listed.body as { experiments: OptimizationExperimentListItem[] }).experiments[0];
  assert.equal(item.max_runtime_ms, experiment.config.max_runtime_ms);
  assert.equal(item.progress?.scored, experiment.summary?.trial_counts.scored);
});
