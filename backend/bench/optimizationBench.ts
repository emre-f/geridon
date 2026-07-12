import os from "node:os";

import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { SeededRandom } from "../src/services/optimization/random.ts";
import type {
  Candle,
  OptimizationConfig,
  OptimizationResult,
  Strategy,
} from "../src/types.ts";

function randomWalkCandles(count: number, timespan: "day" | "hour", seed: number): Candle[] {
  const random = new SeededRandom(seed);
  const stepMs = timespan === "day" ? 86_400_000 : 3_600_000;
  const candles: Candle[] = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const open = close;
    close = Math.max(1, close * (1 + 0.02 * (random.next() * 2 - 1)));
    const high = Math.max(open, close) * (1 + 0.005 * random.next());
    const low = Math.min(open, close) * (1 - 0.005 * random.next());
    candles.push({
      ticker: "BENCH",
      multiplier: 1,
      timespan,
      timestamp_ms: 1600000000000 + index * stepMs,
      open,
      high,
      low,
      close,
      volume: 500_000 + Math.floor(random.next() * 500_000),
      vwap: (open + close) / 2,
      transactions: 100,
    });
  }
  return candles;
}

const macd = (output: "macd" | "signal") =>
  ({
    type: "indicator",
    kind: "macd",
    parameters: { fast: 12, slow: 26, signal: 9 },
    output,
  }) as const;

const rsi = {
  type: "indicator",
  kind: "rsi",
  parameters: { period: 14 },
  output: "rsi",
} as const;

const strategy: Strategy = {
  name: "Bench MACD + RSI",
  entry: {
    type: "group",
    operator: "and",
    conditions: [
      { type: "rule", left: macd("macd"), operator: "cross_above", right: macd("signal") },
      { type: "rule", left: rsi, operator: "lt", right: { type: "value", value: 65 } },
    ],
  },
  exit: {
    type: "group",
    operator: "or",
    conditions: [
      { type: "rule", left: macd("macd"), operator: "cross_below", right: macd("signal") },
      { type: "rule", left: rsi, operator: "gt", right: { type: "value", value: 75 } },
    ],
  },
};

interface Workload {
  name: string;
  candles: Candle[];
  foldCount: number;
}

const workloads: Workload[] = [
  { name: "1d (5y, 1250 candles)", candles: randomWalkCandles(1250, "day", 7), foldCount: 5 },
  { name: "1h (6mo, 3500 candles)", candles: randomWalkCandles(3500, "hour", 11), foldCount: 6 },
];

function foldBacktestCount(result: OptimizationResult, foldCount: number): number {
  const trialFolds = result.trials.reduce((sum, trial) => sum + trial.foldResults.length, 0);
  const ablationFolds = result.ablation.filter((entry) => !entry.skipped).length * foldCount;
  return (
    trialFolds +
    ablationFolds +
    result.baseline.foldResults.length +
    result.buyHold.foldResults.length
  );
}

function runWorkload(workload: Workload) {
  const config: OptimizationConfig = {
    strategy,
    datasets: [{ symbol: "BENCH", candles: workload.candles }],
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    seed: 42,
    maxTrials: 40,
    folds: { foldCount: workload.foldCount, mode: "anchored" },
    scoring: { constraints: { minTotalTrades: 1, maxDrawdownPct: 95, minPositiveFoldFraction: 0 } },
  };

  let peakRss = process.memoryUsage().rss;
  const sampleRss = () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };

  const startedAt = process.hrtime.bigint();
  const result = runOptimization(config, { onTrialFinished: sampleRss });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  sampleRss();

  const evaluations = foldBacktestCount(result, workload.foldCount);
  return {
    workload: workload.name,
    trials: result.trials.length,
    foldBacktests: evaluations,
    elapsedMs: Math.round(elapsedMs),
    evalsPerSecond: Math.round(evaluations / (elapsedMs / 1000)),
    peakRssMb: Math.round(peakRss / 1024 / 1024),
  };
}

console.log(`node ${process.version} | ${os.cpus()[0]?.model ?? "unknown CPU"} | ${os.platform()} ${os.arch()}`);
console.log("workload | trials | fold backtests | elapsed ms | evals/sec | peak RSS MB");
for (const workload of workloads) {
  const row = runWorkload(workload);
  console.log(
    `${row.workload} | ${row.trials} | ${row.foldBacktests} | ${row.elapsedMs} | ${row.evalsPerSecond} | ${row.peakRssMb}`,
  );
}
