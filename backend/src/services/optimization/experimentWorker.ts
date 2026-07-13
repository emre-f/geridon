import { parentPort, workerData } from "node:worker_threads";

import { runOptimization } from "./optimizer.ts";
import type { OptimizationConfig } from "../../types.ts";

const { config, cancelBuffer } = workerData as {
  config: OptimizationConfig;
  cancelBuffer: SharedArrayBuffer;
};
const cancelFlag = new Int32Array(cancelBuffer);

const result = runOptimization(config, {
  shouldStop: () => Atomics.load(cancelFlag, 0) === 1,
  onBaseline: (score) => {
    parentPort?.postMessage({ type: "baseline", baselineScore: score });
  },
  onTrialFinished: (trial) => {
    parentPort?.postMessage({ type: "trial", trial });
  },
});

parentPort?.postMessage({ type: "result", result });
