import { runBacktest } from "../backtest.ts";
import type {
  BacktestMetrics,
  BacktestPositionMode,
  FoldEvaluation,
  FoldSpec,
  OptimizationDataset,
  OptimizationObjective,
  Strategy,
} from "../../types.ts";

export interface EvaluationSettings {
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  objective: OptimizationObjective;
}

export function objectiveFromMetrics(
  metrics: BacktestMetrics,
  objective: OptimizationObjective,
): number | null {
  if (objective === "sharpe") {
    return metrics.sharpe_ratio;
  }
  if (objective === "annualized_return") {
    return metrics.annualized_return_pct;
  }
  return metrics.total_return_pct;
}

function toFoldEvaluation(
  symbol: string,
  fold: FoldSpec,
  metrics: BacktestMetrics,
  objective: OptimizationObjective,
): FoldEvaluation {
  return {
    symbol,
    foldIndex: fold.index,
    objectiveValue: objectiveFromMetrics(metrics, objective),
    total_return_pct: metrics.total_return_pct,
    annualized_return_pct: metrics.annualized_return_pct,
    sharpe_ratio: metrics.sharpe_ratio,
    max_drawdown_pct: metrics.max_drawdown_pct,
    trade_count: metrics.trade_count,
    candle_count: metrics.candle_count,
  };
}

export function evaluateFold(
  strategy: Strategy,
  dataset: OptimizationDataset,
  fold: FoldSpec,
  settings: EvaluationSettings,
): FoldEvaluation {
  const slice = dataset.candles.slice(fold.trainStartIndex, fold.validEndIndex + 1);
  const result = runBacktest({
    strategy,
    candles: slice,
    positionMode: settings.positionMode,
    buyPercent: settings.buyPercent,
    sellPercent: settings.sellPercent,
    initialCapital: settings.initialCapital,
    simulationStartIndex: fold.validStartIndex - fold.trainStartIndex,
  });
  return toFoldEvaluation(dataset.symbol, fold, result.metrics, settings.objective);
}

export function evaluateOnFolds(
  strategy: Strategy,
  datasets: OptimizationDataset[],
  foldsBySymbol: Map<string, FoldSpec[]>,
  settings: EvaluationSettings,
): FoldEvaluation[] {
  const results: FoldEvaluation[] = [];
  for (const dataset of datasets) {
    for (const fold of foldsBySymbol.get(dataset.symbol) ?? []) {
      results.push(evaluateFold(strategy, dataset, fold, settings));
    }
  }
  return results;
}

const alwaysTrue = { type: "price", field: "close" } as const;

export const buyHoldStrategy: Strategy = {
  name: "Buy & Hold",
  entry: { type: "rule", left: alwaysTrue, operator: "gt", right: { type: "value", value: -1e12 } },
  exit: { type: "rule", left: alwaysTrue, operator: "lt", right: { type: "value", value: -1e12 } },
};

export function evaluateBuyHold(
  datasets: OptimizationDataset[],
  foldsBySymbol: Map<string, FoldSpec[]>,
  settings: EvaluationSettings,
): FoldEvaluation[] {
  return evaluateOnFolds(buyHoldStrategy, datasets, foldsBySymbol, {
    ...settings,
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
  });
}
