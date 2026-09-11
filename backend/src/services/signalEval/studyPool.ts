import { Worker } from "node:worker_threads";

import type { CloseBar } from "../forwardReturns.ts";
import { runEventStudy, type EventStudyResult, type StudyEvent } from "./eventStudy.ts";

export interface StudyTask {
  events: StudyEvent[];
  seed: number;
  maxHorizon?: number;
  bootstrapIterations?: number;
}

/**
 * Runs independent event studies, inline or fanned across worker threads.
 * Results come back in task order regardless of which worker finishes first,
 * and each study seeds its own RNG, so a pooled run is byte-identical to the
 * inline path — only the number-crunching moves off the main thread.
 */
export interface StudyRunner {
  run(tasks: StudyTask[]): Promise<EventStudyResult[]>;
  close(): Promise<void>;
}

export function createStudyRunner(
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>,
  marketBars: readonly CloseBar[],
  workerCount: number,
): StudyRunner {
  return workerCount > 1
    ? createStudyPool(barsByTicker, marketBars, workerCount)
    : createInlineStudyRunner(barsByTicker, marketBars);
}

function createInlineStudyRunner(
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>,
  marketBars: readonly CloseBar[],
): StudyRunner {
  return {
    run: (tasks) =>
      Promise.resolve(tasks.map((task) => runEventStudy({ ...task, barsByTicker, marketBars }))),
    close: () => Promise.resolve(),
  };
}

interface PooledWorker {
  worker: Worker;
  pending: Map<number, (results: EventStudyResult[]) => void>;
}

function chunk<T>(items: T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts);
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function createStudyPool(
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>,
  marketBars: readonly CloseBar[],
  workerCount: number,
): StudyRunner {
  const workers: PooledWorker[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    const worker = new Worker(new URL("./studyWorker.ts", import.meta.url), {
      workerData: { barsByTicker, marketBars },
    });
    const pending = new Map<number, (results: EventStudyResult[]) => void>();
    worker.on("message", (message: { id: number; results: EventStudyResult[] }) => {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.results);
    });
    workers.push({ worker, pending });
  }

  let sequence = 0;

  function dispatch(target: PooledWorker, tasks: StudyTask[]): Promise<EventStudyResult[]> {
    const id = sequence++;
    return new Promise((resolve) => {
      target.pending.set(id, resolve);
      target.worker.postMessage({ id, tasks });
    });
  }

  return {
    async run(tasks) {
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
