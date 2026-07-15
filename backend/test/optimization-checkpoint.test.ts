import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleCancelExperiment,
  handleCreateExperiment,
  handleResumeExperiment,
} from "../src/api/optimizationExperiments.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { loadCheckpointFolds } from "../src/services/optimization/trialStore.ts";
import type {
  CheckpointTrialFolds,
  OptimizationConfig,
  OptimizationResult,
} from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";
import { baseConfig, thresholdStrategy } from "./optimizationFixtures.ts";

function checkpointFromResult(result: OptimizationResult): CheckpointTrialFolds[] {
  return result.trials
    .filter((trial) => trial.foldResults.length > 0)
    .map((trial) => ({ hash: trial.hash, foldResults: trial.foldResults }));
}

function comparableJson(result: OptimizationResult): string {
  const { checkpointFoldsReused: _reused, ...rest } = result;
  return JSON.stringify(rest);
}

function tunableConfig(method: "random" | "tpe"): OptimizationConfig {
  return baseConfig(thresholdStrategy(95, 105), {
    method,
    maxTrials: 30,
    parameterOverrides: {
      "entry.right.value": { min: 88, max: 99 },
      "exit.right.value": { min: 102, max: 112 },
    },
  });
}

for (const method of ["random", "tpe"] as const) {
  test(`a ${method} run resumed from a full checkpoint reuses folds and stays byte-identical`, async () => {
    const fresh = await runOptimization(tunableConfig(method));
    assert.equal(fresh.checkpointFoldsReused, 0);

    const resumed = await runOptimization({
      ...tunableConfig(method),
      checkpoint: checkpointFromResult(fresh),
    });
    assert.ok(resumed.checkpointFoldsReused > 0);
    assert.equal(comparableJson(resumed), comparableJson(fresh));
  });
}

test("a partial checkpoint is reused for the trials it covers and the rest recompute identically", async () => {
  const fresh = await runOptimization(tunableConfig("random"));
  const partial = checkpointFromResult(fresh);
  const kept = partial.slice(0, Math.floor(partial.length / 2));
  assert.ok(kept.length > 0 && kept.length < partial.length);

  const resumed = await runOptimization({ ...tunableConfig("random"), checkpoint: kept });
  assert.ok(resumed.checkpointFoldsReused > 0);
  const keptFoldCount = kept.reduce((sum, entry) => sum + entry.foldResults.length, 0);
  assert.ok(resumed.checkpointFoldsReused <= keptFoldCount);
  assert.equal(comparableJson(resumed), comparableJson(fresh));
});

test("resuming a cancelled experiment reuses its streamed trials as a checkpoint", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 2000);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);
  const body = experimentBody(strategyId, {
    max_trials: 300,
    max_runtime_ms: 60_000,
    parameter_overrides: {
      "entry.right.value": { min: 88, max: 99 },
      "exit.right.value": { min: 102, max: 112 },
    },
  });

  const reference = await runToCompletion(db, runner, body);
  assert.equal(reference.status, "completed");

  const created = handleCreateExperiment(db, runner, body);
  assert.equal(created.statusCode, 201);
  const interrupted = (created.body as { id: number }).id;

  // Cancelling before any evaluated trial streamed would leave an empty
  // checkpoint (nothing to reuse), so wait for a row that carries folds.
  const evaluatedTrialCount = () =>
    Number(
      (db
        .prepare(
          `SELECT COUNT(*) AS count FROM optimization_trials
           WHERE experiment_id = ? AND status IN ('scored', 'pruned')
             AND fold_results IS NOT NULL AND fold_results != '[]'`,
        )
        .get(interrupted) as { count: number }).count,
    );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && evaluatedTrialCount() === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(evaluatedTrialCount() > 0, "expected streamed evaluated trials before cancelling");
  handleCancelExperiment(db, runner, String(interrupted));
  await runner.waitForFinish(interrupted);
  assert.equal(getExperiment(db, interrupted)!.status, "cancelled");

  const checkpoint = loadCheckpointFolds(db, interrupted);
  assert.ok(checkpoint.length > 0, "cancelled run should leave checkpointable fold results");

  const resumed = handleResumeExperiment(db, runner, String(interrupted));
  assert.equal(resumed.statusCode, 202);
  await runner.waitForFinish(interrupted);

  const experiment = getExperiment(db, interrupted)!;
  assert.equal(experiment.status, "completed");
  assert.ok((experiment.summary!.checkpoint_folds_reused ?? 0) > 0);

  assert.equal(
    experiment.summary!.best_trial_index,
    reference.summary!.best_trial_index,
  );
  assert.deepEqual(experiment.summary!.trial_counts, reference.summary!.trial_counts);
  assert.deepEqual(experiment.summary!.baseline, reference.summary!.baseline);
});
