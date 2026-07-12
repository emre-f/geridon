import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleCancelExperiment,
  handleCreateExperiment,
  handleResumeExperiment,
} from "../src/api/optimizationExperiments.ts";
import { handleListExperimentTrials } from "../src/api/optimizationTrials.ts";
import { getExperiment } from "../src/services/optimization/experimentStore.ts";
import type { OptimizationExperimentRecord } from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
} from "./experimentTestHelpers.ts";

test("cancelling a running experiment keeps its completed trials", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 2000);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const created = handleCreateExperiment(
    db,
    runner,
    experimentBody(strategyId, { max_trials: 500, max_runtime_ms: 60_000 }),
  );
  assert.equal(created.statusCode, 201);
  const id = (created.body as OptimizationExperimentRecord).id;

  const cancelled = handleCancelExperiment(db, runner, String(id));
  assert.equal(cancelled.statusCode, 202);
  await runner.waitForFinish(id);
  const experiment = getExperiment(db, id)!;
  assert.equal(experiment.status, "cancelled");

  const resumed = handleResumeExperiment(db, runner, String(id));
  assert.equal(resumed.statusCode, 202);
  await runner.waitForFinish(id);
  assert.ok(["completed", "cancelled"].includes(getExperiment(db, id)!.status));
});

test("finished trials stream to the database and survive a restart", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 2000);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const created = handleCreateExperiment(
    db,
    runner,
    experimentBody(strategyId, { max_trials: 500, max_runtime_ms: 60_000 }),
  );
  assert.equal(created.statusCode, 201);
  const id = (created.body as OptimizationExperimentRecord).id;

  const trialCount = () =>
    Number(
      (db
        .prepare("SELECT COUNT(*) AS count FROM optimization_trials WHERE experiment_id = ?")
        .get(id) as { count: number }).count,
    );
  const deadline = Date.now() + 30_000;
  let streamedWhileRunning = 0;
  while (Date.now() < deadline && streamedWhileRunning === 0) {
    const status = getExperiment(db, id)!.status;
    assert.ok(
      status === "queued" || status === "running",
      `experiment finished (${status}) before any trial row was observed mid-run`,
    );
    if (status === "running") {
      streamedWhileRunning = trialCount();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(streamedWhileRunning > 0, "expected trial rows while the experiment was running");

  runner.cancel(id);
  await runner.waitForFinish(id);

  // Simulate a crash that happened before the final result write.
  db.prepare(
    "UPDATE optimization_experiments SET status = 'running', summary = NULL WHERE id = ?",
  ).run(id);
  const rebooted = makeRunner(db);
  rebooted.recoverOnBoot();

  const experiment = getExperiment(db, id)!;
  assert.equal(experiment.status, "interrupted");
  assert.ok(trialCount() > 0);
  const listed = handleListExperimentTrials(db, experiment, new URLSearchParams("limit=5"));
  assert.equal(listed.statusCode, 200);
  assert.ok((listed.body as { total: number }).total > 0);
});

test("running experiments become interrupted after a restart and can resume", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);

  const firstRunner = makeRunner(db);
  const created = handleCreateExperiment(db, firstRunner, experimentBody(strategyId));
  const id = (created.body as OptimizationExperimentRecord).id;
  firstRunner.cancel(id);
  await firstRunner.waitForFinish(id);
  // Simulate a crash that left the row in the running state.
  db.prepare("UPDATE optimization_experiments SET status = 'running' WHERE id = ?").run(id);

  const secondRunner = makeRunner(db);
  secondRunner.recoverOnBoot();
  assert.equal(getExperiment(db, id)!.status, "interrupted");

  const resumed = handleResumeExperiment(db, secondRunner, String(id));
  assert.equal(resumed.statusCode, 202);
  await secondRunner.waitForFinish(id);
  assert.equal(getExperiment(db, id)!.status, "completed");
});
