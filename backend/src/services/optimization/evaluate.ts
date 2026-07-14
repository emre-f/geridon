import { runBacktest } from "../backtest.ts";
import type { FoldCheckpoint } from "./checkpoint.ts";
import type { IndicatorSeriesCache } from "./indicatorCache.ts";
import type {
  BacktestMetrics,
  BacktestPositionMode,
  FoldEquityCurve,
  FoldEvaluation,
  FoldSpec,
  OptimizationDataset,
  OptimizationObjective,
  Strategy,
  TradeCosts,
  TrialSizing,
} from "../../types.ts";

export interface EvaluationSettings {
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  costs?: TradeCosts;
  objective: OptimizationObjective;
  cache?: IndicatorSeriesCache;
  checkpoint?: FoldCheckpoint;
}

/** Evaluation settings with one candidate's sampled sizing applied. */
export function withSizing(
  settings: EvaluationSettings,
  sizing?: TrialSizing,
): EvaluationSettings {
  if (!sizing || (sizing.buyPercent == null && sizing.sellPercent == null)) {
    return settings;
  }
  return {
    ...settings,
    buyPercent: sizing.buyPercent ?? settings.buyPercent,
    sellPercent: sizing.sellPercent ?? settings.sellPercent,
  };
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
    exposure_pct: metrics.exposure_pct,
    turnover_ratio: metrics.turnover_ratio,
  };
}

function runFoldBacktest(
  strategy: Strategy,
  dataset: OptimizationDataset,
  fold: FoldSpec,
  settings: EvaluationSettings,
) {
  const slice = dataset.candles.slice(fold.trainStartIndex, fold.validEndIndex + 1);
  return runBacktest({
    strategy,
    candles: slice,
    positionMode: settings.positionMode,
    buyPercent: settings.buyPercent,
    sellPercent: settings.sellPercent,
    initialCapital: settings.initialCapital,
    costs: settings.costs,
    simulationStartIndex: fold.validStartIndex - fold.trainStartIndex,
    indicatorCache: settings.cache?.scope(
      dataset.symbol,
      fold.trainStartIndex,
      fold.validEndIndex,
    ),
  });
}

export function evaluateFold(
  strategy: Strategy,
  dataset: OptimizationDataset,
  fold: FoldSpec,
  settings: EvaluationSettings,
): FoldEvaluation {
  const result = runFoldBacktest(strategy, dataset, fold, settings);
  return toFoldEvaluation(dataset.symbol, fold, result.metrics, settings.objective);
}

export function equityOnFolds(
  strategy: Strategy,
  datasets: OptimizationDataset[],
  foldsBySymbol: Map<string, FoldSpec[]>,
  settings: EvaluationSettings,
): FoldEquityCurve[] {
  const curves: FoldEquityCurve[] = [];
  for (const dataset of datasets) {
    for (const fold of foldsBySymbol.get(dataset.symbol) ?? []) {
      const result = runFoldBacktest(strategy, dataset, fold, settings);
      curves.push({
        symbol: dataset.symbol,
        foldIndex: fold.index,
        points: result.equity_curve.map(({ timestamp_ms, equity }) => ({ timestamp_ms, equity })),
      });
    }
  }
  return curves;
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
