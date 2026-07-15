import { Worker } from "node:worker_threads";

import type {
  BacktestPositionMode,
  FoldEvaluation,
  FoldSpec,
  OptimizationDataset,
  OptimizationObjective,
  Strategy,
  TradeCosts,
} from "../../types.ts";

/** Run-constant settings sent to each worker once; sizing is per-task. */
export interface PoolBaseSettings {
  positionMode: BacktestPositionMode;
  initialCapital: number;
  costs?: TradeCosts;
  objective: OptimizationObjective;
}

export interface PoolFoldTask {
  strategy: Strategy;
  buyPercent: number;
  sellPercent: number;
  symbol: string;
  fold: FoldSpec;
}

/**
 * Fans independent fold backtests across worker threads. Results are returned
 * in task order regardless of which worker finishes first, so a pooled run is
 * byte-identical to the single-threaded path — only the number-crunching moves
 * off the main thread. Created only when worker_count > 1.
 */
export interface EvaluationPool {
  map(tasks: PoolFoldTask[]): Promise<FoldEvaluation[]>;
  close(): Promise<void>;
}

interface PooledWorker {
  worker: Worker;
  pending: Map<number, (results: FoldEvaluation[]) => void>;
}

function chunk<T>(items: T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts);
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

export function createEvaluationPool(
  datasets: OptimizationDataset[],
  base: PoolBaseSettings,
  workerCount: number,
  cacheValues?: number,
): EvaluationPool {
  const workers: PooledWorker[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    const worker = new Worker(new URL("./evaluationWorker.ts", import.meta.url), {
      workerData: { datasets, base, cacheValues },
    });
    const pending = new Map<number, (results: FoldEvaluation[]) => void>();
    worker.on("message", (message: { id: number; results: FoldEvaluation[] }) => {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.results);
    });
    workers.push({ worker, pending });
  }

  let sequence = 0;

  function dispatch(target: PooledWorker, tasks: PoolFoldTask[]): Promise<FoldEvaluation[]> {
    const id = sequence++;
    return new Promise((resolve) => {
      target.pending.set(id, resolve);
      target.worker.postMessage({ id, tasks });
    });
  }

  return {
    async map(tasks) {
      if (tasks.length === 0) {
        return [];
      }
      const chunks = chunk(tasks, workers.length);
      const settled = await Promise.all(
        chunks.map((slice, index) => dispatch(workers[index], slice)),
      );
      return settled.flat();
    },
    async close() {
      await Promise.all(workers.map(({ worker }) => worker.terminate()));
    },
  };
}
