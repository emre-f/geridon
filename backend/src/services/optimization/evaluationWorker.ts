import { parentPort, workerData } from "node:worker_threads";

import { evaluateFold } from "./evaluate.ts";
import { createIndicatorSeriesCache } from "./indicatorCache.ts";
import type { PoolBaseSettings, PoolFoldTask } from "./evaluationPool.ts";
import type { FoldEvaluation, OptimizationDataset } from "../../types.ts";

const { datasets, base, cacheValues } = workerData as {
  datasets: OptimizationDataset[];
  base: PoolBaseSettings;
  cacheValues?: number;
};

const datasetsBySymbol = new Map<string, OptimizationDataset>();
for (const dataset of datasets) {
  datasetsBySymbol.set(dataset.symbol, dataset);
}
const cache = createIndicatorSeriesCache(cacheValues);

function evaluateTask(task: PoolFoldTask): FoldEvaluation {
  const dataset = datasetsBySymbol.get(task.symbol) ?? { symbol: task.symbol, candles: [] };
  return evaluateFold(task.strategy, dataset, task.fold, {
    positionMode: base.positionMode,
    buyPercent: task.buyPercent,
    sellPercent: task.sellPercent,
    initialCapital: base.initialCapital,
    costs: base.costs,
    objective: base.objective,
    cache,
  });
}

parentPort?.on("message", (message: { id: number; tasks: PoolFoldTask[] }) => {
  const results = message.tasks.map(evaluateTask);
  parentPort?.postMessage({ id: message.id, results });
});
