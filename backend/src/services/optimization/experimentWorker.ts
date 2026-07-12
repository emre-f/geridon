import { parentPort, workerData } from "node:worker_threads";

import { runOptimization } from "./optimizer.ts";
import type { OptimizationConfig } from "../../types.ts";

const { config, cancelBuffer } = workerData as {
  config: OptimizationConfig;
  cancelBuffer: SharedArrayBuffer;
};
const cancelFlag = new Int32Array(cancelBuffer);
let lastProgressAtMs = 0;

const result = runOptimization(config, {
  shouldStop: () => Atomics.load(cancelFlag, 0) === 1,
  onTrialComplete: (completedCount) => {
    const now = Date.now();
    if (now - lastProgressAtMs >= 200) {
      lastProgressAtMs = now;
      parentPort?.postMessage({ type: "progress", evaluated: completedCount });
    }
  },
  onTrialFinished: (trial) => {
    parentPort?.postMessage({ type: "trial", trial });
  },
});

parentPort?.postMessage({ type: "result", result });
