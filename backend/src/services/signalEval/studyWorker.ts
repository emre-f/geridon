import { parentPort, workerData } from "node:worker_threads";

import type { CloseBar } from "../forwardReturns.ts";
import { runEventStudy } from "./eventStudy.ts";
import type { StudyTask } from "./studyPool.ts";

const { barsByTicker, marketBars } = workerData as {
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>;
  marketBars: readonly CloseBar[];
};

parentPort?.on("message", ({ id, tasks }: { id: number; tasks: StudyTask[] }) => {
  const results = tasks.map((task) => runEventStudy({ ...task, barsByTicker, marketBars }));
  parentPort?.postMessage({ id, results });
});
