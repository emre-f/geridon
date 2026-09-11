import { availableParallelism } from "node:os";

import type { Database } from "../../db.ts";
import { evaluateEventSignal, type SignalEvaluationPackage } from "./evaluate.ts";
import { signalHoldoutStartMs, type EventSelectionOptions } from "./eventSelection.ts";
import {
  getJob,
  markJobStatus,
  recoverJobs,
  type SignalJobRow,
} from "./evaluationJobStore.ts";
import { consumeHoldout, getEvaluation, recordEvaluation } from "./registry.ts";

export const signalEvalVersion = 1;

interface ResolvedJob {
  query: EventSelectionOptions;
  seed: number;
}

/**
 * Runs signal evaluation jobs one at a time through `evaluateEventSignal`,
 * which fans the studies across worker threads; database access (job
 * bookkeeping, registry writes) stays on this thread, mirroring the
 * optimization runner.
 */
export class SignalEvaluationRunner {
  private readonly db: Database;
  private readonly workerCount: number;
  private readonly queue: number[] = [];
  private activeId: number | null = null;
  private readonly finishWaiters = new Map<number, Array<() => void>>();

  constructor(db: Database, options: { workerCount?: number } = {}) {
    this.db = db;
    this.workerCount = options.workerCount ?? availableParallelism();
  }

  recoverOnBoot() {
    for (const id of recoverJobs(this.db)) {
      this.enqueue(id);
    }
  }

  enqueue(jobId: number) {
    this.queue.push(jobId);
    this.pump();
  }

  isRunning(jobId: number): boolean {
    return this.activeId === jobId || this.queue.includes(jobId);
  }

  waitForFinish(jobId: number): Promise<void> {
    if (!this.isRunning(jobId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = this.finishWaiters.get(jobId) ?? [];
      waiters.push(resolve);
      this.finishWaiters.set(jobId, waiters);
    });
  }

  private pump() {
    if (this.activeId != null) {
      return;
    }
    const nextId = this.queue.shift();
    if (nextId == null) {
      return;
    }
    this.activeId = nextId;
    void this.execute(nextId);
  }

  private async execute(jobId: number) {
    const job = getJob(this.db, jobId);
    if (job && job.status === "queued") {
      markJobStatus(this.db, jobId, "running");
      try {
        const resolved = this.resolveJob(job);
        const evaluation = await evaluateEventSignal(this.db, {
          query: resolved.query,
          seed: resolved.seed,
          costs: job.request.costs,
          notionalPerEvent: job.request.notional_per_event,
          bootstrapIterations: job.request.bootstrap_iterations,
          workerCount: this.workerCount,
        });
        this.persist(job, evaluation);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Signal evaluation failed.";
        markJobStatus(this.db, jobId, "failed", { error: message });
      }
    }
    this.finishJob(jobId);
  }

  /**
   * A holdout job reruns the recorded query on the sealed window only: same
   * filters, same seed, range forced to the holdout boundary onward.
   */
  private resolveJob(job: SignalJobRow): ResolvedJob {
    if (job.job_type === "evaluation") {
      if (job.request.query == null) {
        throw new Error("Evaluation job is missing its query.");
      }
      return { query: job.request.query, seed: job.request.seed ?? 1 };
    }

    const evaluationId = job.request.evaluation_id;
    if (evaluationId == null) {
      throw new Error("Holdout job is missing its evaluation id.");
    }
    const evaluation = getEvaluation(this.db, evaluationId);
    if (evaluation == null) {
      throw new Error(`Signal evaluation ${evaluationId} not found.`);
    }
    if (evaluation.verdict !== "candidate") {
      throw new Error(`Holdout requires a candidate verdict; evaluation ${evaluationId} is ${evaluation.verdict}.`);
    }
    if (evaluation.holdout_consumed_at != null) {
      throw new Error(`Holdout for evaluation ${evaluationId} was already consumed.`);
    }
    return {
      query: {
        ...evaluation.query,
        startMs: signalHoldoutStartMs,
        endMs: undefined,
        includeHoldout: true,
      },
      seed: evaluation.seed,
    };
  }

  private persist(job: SignalJobRow, evaluation: SignalEvaluationPackage) {
    const detail = {
      selection: evaluation.selection,
      study: evaluation.study,
      horizon_summary: evaluation.horizon_summary,
      cost_line: evaluation.cost_line,
      score_analysis: evaluation.score_analysis,
    };
    if (job.job_type === "evaluation") {
      const row = recordEvaluation(this.db, {
        query: evaluation.query,
        seed: evaluation.seed,
        headline: evaluation.headline,
        detail,
        versions: { signal_eval_version: signalEvalVersion },
      });
      markJobStatus(this.db, job.id, "completed", {
        evaluationId: row.id,
        selectionStats: evaluation.selection,
      });
      return;
    }
    const row = consumeHoldout(this.db, job.request.evaluation_id as number, {
      headline: evaluation.headline,
      verdict: evaluation.verdict,
      detail,
    });
    markJobStatus(this.db, job.id, "completed", {
      evaluationId: row.id,
      selectionStats: evaluation.selection,
    });
  }

  private finishJob(jobId: number) {
    if (this.activeId === jobId) {
      this.activeId = null;
    }
    const waiters = this.finishWaiters.get(jobId);
    this.finishWaiters.delete(jobId);
    for (const resolve of waiters ?? []) {
      resolve();
    }
    this.pump();
  }
}
