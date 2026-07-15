import { parentPort, workerData } from "node:worker_threads";

import { evaluateFold } from "./evaluate.ts";
import { createIndicatorSeriesCache } from "./indicatorCache.ts";
import type { PoolBaseSettings, PoolFoldTask } from "./evaluationPool.ts";
import type { Candle, FoldEvaluation, OptimizationDataset } from "../../types.ts";

const { datasets, base, cacheValues } = workerData as {
  datasets: OptimizationDataset[];
  base: PoolBaseSettings;
  cacheValues?: number;
};

const candlesBySymbol = new Map<string, Candle[]>();
for (const dataset of datasets) {
  candlesBySymbol.set(dataset.symbol, dataset.candles);
}
const cache = createIndicatorSeriesCache(cacheValues);

function evaluateTask(task: PoolFoldTask): FoldEvaluation {
  const candles = candlesBySymbol.get(task.symbol) ?? [];
  return evaluateFold(task.strategy, { symbol: task.symbol, candles }, task.fold, {
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
