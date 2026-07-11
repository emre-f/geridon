import { Worker } from "node:worker_threads";

import type { Database } from "../../db.ts";
import type {
  OptimizationConfig,
  OptimizationDataset,
  OptimizationExperimentConfig,
  OptimizationExperimentRecord,
  OptimizationExperimentStatus,
  OptimizationResult,
} from "../../types.ts";
import {
  getExperiment,
  persistExperimentResult,
  updateExperimentProgress,
  updateExperimentStatus,
} from "./experimentStore.ts";

export type DatasetLoader = (config: OptimizationExperimentConfig) => OptimizationDataset[];

interface ActiveExperiment {
  id: number;
  worker: Worker;
  cancelFlag: Int32Array;
  cancelRequested: boolean;
  startedAtMs: number;
  finished: boolean;
}

function toEngineConfig(
  record: OptimizationExperimentRecord,
  datasets: OptimizationDataset[],
): OptimizationConfig {
  const config = record.config;
  return {
    strategy: record.snapshot.strategy,
    datasets,
    positionMode: config.position_mode,
    buyPercent: config.buy_percent,
    sellPercent: config.sell_percent,
    initialCapital: config.initial_capital,
    costs: config.costs,
    seed: config.seed,
    maxTrials: config.max_trials,
    maxRuntimeMs: config.max_runtime_ms,
    folds: config.folds,
    scoring: config.scoring,
    ruleRoles: config.rule_roles,
    parameterOverrides: config.parameter_overrides,
    halving: config.halving,
    refinement: config.refinement,
    method: config.method,
    tpe: config.tpe,
    evolution: config.evolution,
  };
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
    updateExperimentProgress(this.db, experimentId, {
      evaluated_trials: 0,
      max_trials: record.config.max_trials,
      updated_at_ms: Date.now(),
    });

    const cancelBuffer = new SharedArrayBuffer(4);
    const worker = new Worker(new URL("./experimentWorker.ts", import.meta.url), {
      workerData: { config: toEngineConfig(record, datasets), cancelBuffer },
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

    worker.on("message", (message: { type: string; evaluated?: number; result?: OptimizationResult }) => {
      if (message.type === "progress" && message.evaluated != null) {
        updateExperimentProgress(this.db, experimentId, {
          evaluated_trials: message.evaluated,
          max_trials: record.config.max_trials,
          updated_at_ms: Date.now(),
        });
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
