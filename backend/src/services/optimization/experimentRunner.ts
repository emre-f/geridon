import { Worker } from "node:worker_threads";

import type { Database } from "../../db.ts";
import type {
  OptimizationDataset,
  OptimizationExperimentConfig,
  OptimizationExperimentStatus,
  OptimizationResult,
  OptimizationTrial,
} from "../../types.ts";
import {
  getExperiment,
  updateExperimentProgress,
  updateExperimentStatus,
} from "./experimentStore.ts";
import {
  clearTrialRows,
  loadCheckpointFolds,
  persistExperimentResult,
  upsertTrialRow,
} from "./trialStore.ts";
import { toEngineConfig } from "./engineConfig.ts";
import { ProgressTracker } from "./progressTracker.ts";

const progressWriteIntervalMs = 200;

export type DatasetLoader = (config: OptimizationExperimentConfig) => OptimizationDataset[];

interface ActiveExperiment {
  id: number;
  worker: Worker;
  cancelFlag: Int32Array;
  cancelRequested: boolean;
  startedAtMs: number;
  finished: boolean;
}

export class ExperimentRunner {
  private readonly db: Database;
  private readonly loadDatasets: DatasetLoader;
  private readonly queue: number[] = [];
  private active: ActiveExperiment | null = null;
  private readonly finishWaiters = new Map<number, Array<() => void>>();

  constructor(db: Database, loadDatasets: DatasetLoader) {
    this.db = db;
    this.loadDatasets = loadDatasets;
  }

  recoverOnBoot() {
    this.db
      .prepare("UPDATE optimization_experiments SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP WHERE status = 'running'")
      .run();
    const queued = this.db
      .prepare("SELECT id FROM optimization_experiments WHERE status = 'queued' ORDER BY id ASC")
      .all() as Array<{ id: number }>;
    for (const row of queued) {
      this.enqueue(Number(row.id));
    }
  }

  enqueue(experimentId: number) {
    this.queue.push(experimentId);
    this.pump();
  }

  /**
   * Returns the resulting lifecycle step: "cancelling" while the worker winds
   * down cooperatively, "cancelled" when the experiment was still queued, or
   * null when this runner is not tracking the experiment.
   */
  cancel(experimentId: number): "cancelling" | "cancelled" | null {
    if (this.active?.id === experimentId && !this.active.finished) {
      this.active.cancelRequested = true;
      Atomics.store(this.active.cancelFlag, 0, 1);
      return "cancelling";
    }
    const position = this.queue.indexOf(experimentId);
    if (position >= 0) {
      this.queue.splice(position, 1);
      updateExperimentStatus(this.db, experimentId, "cancelled");
      this.notifyFinish(experimentId);
      return "cancelled";
    }
    return null;
  }

  isRunning(experimentId: number): boolean {
    return (this.active?.id === experimentId && !this.active.finished) ||
      this.queue.includes(experimentId);
  }

  waitForFinish(experimentId: number): Promise<void> {
    if (!this.isRunning(experimentId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = this.finishWaiters.get(experimentId) ?? [];
      waiters.push(resolve);
      this.finishWaiters.set(experimentId, waiters);
    });
  }

  private pump() {
    if (this.active) {
      return;
    }
    const nextId = this.queue.shift();
    if (nextId == null) {
      return;
    }
    this.start(nextId);
  }

  private start(experimentId: number) {
    const record = getExperiment(this.db, experimentId);
    if (!record || record.status !== "queued") {
      this.notifyFinish(experimentId);
      this.pump();
      return;
    }

    let datasets: OptimizationDataset[];
    try {
      datasets = this.loadDatasets(record.config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load experiment data.";
      updateExperimentStatus(this.db, experimentId, "failed", message);
      this.notifyFinish(experimentId);
      this.pump();
      return;
    }

    updateExperimentStatus(this.db, experimentId, "running");
    const tracker = new ProgressTracker(record.config.max_trials, Date.now());
    updateExperimentProgress(this.db, experimentId, tracker.snapshot(Date.now()));
    let lastProgressWriteMs = Date.now();
    const writeProgress = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastProgressWriteMs < progressWriteIntervalMs) {
        return;
      }
      lastProgressWriteMs = now;
      updateExperimentProgress(this.db, experimentId, tracker.snapshot(now));
    };

    // Trial rows left by an interrupted run become the resume checkpoint,
    // then clear so the resumed run streams a fresh, consistent set.
    const checkpoint = loadCheckpointFolds(this.db, experimentId);
    clearTrialRows(this.db, experimentId);
    const cancelBuffer = new SharedArrayBuffer(4);
    const worker = new Worker(new URL("./experimentWorker.ts", import.meta.url), {
      workerData: { config: toEngineConfig(record, datasets, checkpoint), cancelBuffer },
    });
    const active: ActiveExperiment = {
      id: experimentId,
      worker,
      cancelFlag: new Int32Array(cancelBuffer),
      cancelRequested: false,
      startedAtMs: Date.now(),
      finished: false,
    };
    this.active = active;

    worker.on("message", (message: {
      type: string;
      baselineScore?: number;
      trial?: OptimizationTrial;
      result?: OptimizationResult;
    }) => {
      if (message.type === "baseline" && message.baselineScore != null) {
        tracker.recordBaseline(message.baselineScore);
        writeProgress(true);
        return;
      }
      // Each finished trial lands in SQLite immediately so a crash or
      // restart keeps completed work; the final result pass fills in ranks.
      if (message.type === "trial" && message.trial) {
        upsertTrialRow(this.db, experimentId, message.trial);
        tracker.recordTrial(message.trial);
        writeProgress(false);
        return;
      }
      if (message.type === "result" && message.result) {
        const status: OptimizationExperimentStatus = active.cancelRequested
          ? "cancelled"
          : "completed";
        persistExperimentResult(
          this.db,
          experimentId,
          status,
          message.result,
          Date.now() - active.startedAtMs,
          record.config.max_trials,
        );
        this.finish(active);
      }
    });
    worker.on("error", (error) => {
      if (!active.finished) {
        updateExperimentStatus(this.db, experimentId, "failed", error.message);
        this.finish(active);
      }
    });
    worker.on("exit", (code) => {
      if (!active.finished) {
        updateExperimentStatus(
          this.db,
          experimentId,
          "failed",
          `Optimization worker exited unexpectedly with code ${code}.`,
        );
        this.finish(active);
      }
    });
  }

  private finish(active: ActiveExperiment) {
    active.finished = true;
    void active.worker.terminate();
    this.active = null;
    this.notifyFinish(active.id);
    this.pump();
  }

  private notifyFinish(experimentId: number) {
    const waiters = this.finishWaiters.get(experimentId);
    this.finishWaiters.delete(experimentId);
    for (const resolve of waiters ?? []) {
      resolve();
    }
  }
}
