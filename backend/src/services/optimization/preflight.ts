import { resolveRefinementConfig } from "./coarseToFine.ts";
import { evaluateOnFolds, type EvaluationSettings } from "./evaluate.ts";
import { spreadFoldSubset } from "./folds.ts";
import { collectRules } from "./strategyPaths.ts";
import { resolveHalvingConfig } from "./successiveHalving.ts";
import type {
  FoldSpec,
  HoldoutConfig,
  OptimizationDataset,
  PreflightBenchmark,
  PreflightEvaluationEstimate,
  PreflightSymbolTimeline,
  RefinementConfig,
  Strategy,
  SuccessiveHalvingConfig,
} from "../../types.ts";

export interface EvaluationPlanInput {
  method: "random" | "tpe" | "evolution";
  maxTrials: number;
  foldsBySymbol: Map<string, FoldSpec[]>;
  halving?: Partial<SuccessiveHalvingConfig>;
  refinement?: Partial<RefinementConfig>;
  activeRuleCount: number;
}

function totalFoldCount(foldsBySymbol: Map<string, FoldSpec[]>): number {
  let total = 0;
  for (const folds of foldsBySymbol.values()) {
    total += folds.length;
  }
  return total;
}

/**
 * Fold backtests a random search will spend under successive halving: each
 * stage evaluates its survivors on that stage's fold subset, and the fold
 * cache means a promoted trial only pays for folds it has not seen yet.
 */
function halvingEvaluations(
  trialCount: number,
  foldsBySymbol: Map<string, FoldSpec[]>,
  halving: SuccessiveHalvingConfig,
): number {
  const stages = halving.stageFoldFractions;
  const newFoldsPerStage = stages.map(() => 0);
  for (const folds of foldsBySymbol.values()) {
    const seen = new Set<number>();
    stages.forEach((fraction, stage) => {
      for (const fold of spreadFoldSubset(folds, Math.ceil(folds.length * fraction))) {
        if (!seen.has(fold.index)) {
          seen.add(fold.index);
          newFoldsPerStage[stage] += 1;
        }
      }
    });
  }

  let survivors = trialCount;
  let total = 0;
  for (let stage = 0; stage < stages.length; stage += 1) {
    total += survivors * newFoldsPerStage[stage];
    if (stage < stages.length - 1) {
      survivors = Math.max(1, Math.ceil(survivors * halving.promotionRate));
    }
  }
  return total;
}

export function planEvaluations(input: EvaluationPlanInput): PreflightEvaluationEstimate {
  const totalFolds = totalFoldCount(input.foldsBySymbol);
  const refinement = resolveRefinementConfig(input.refinement, input.maxTrials);
  const refinementTrials =
    input.method !== "evolution" && refinement.enabled
      ? Math.min(refinement.trials, Math.max(0, input.maxTrials - 1))
      : 0;
  const searchTrials = input.maxTrials - refinementTrials;

  const search =
    input.method === "random"
      ? halvingEvaluations(searchTrials, input.foldsBySymbol, resolveHalvingConfig(input.halving))
      : searchTrials * totalFolds;
  const refinementEvaluations = refinementTrials * totalFolds;
  const baselineAndBenchmarks = 2 * totalFolds;
  const ablationMax = input.activeRuleCount * totalFolds;

  return {
    total: search + refinementEvaluations + baselineAndBenchmarks + ablationMax,
    search,
    refinement: refinementEvaluations,
    baseline_and_benchmarks: baselineAndBenchmarks,
    ablation_max: ablationMax,
  };
}

export function activeRuleCount(strategy: Strategy): number {
  return collectRules(strategy).filter(({ rule }) => rule.enabled !== false).length;
}

export function benchmarkBaseline(
  strategy: Strategy,
  searchData: OptimizationDataset[],
  foldsBySymbol: Map<string, FoldSpec[]>,
  settings: EvaluationSettings,
): PreflightBenchmark {
  const startedAt = performance.now();
  const results = evaluateOnFolds(strategy, searchData, foldsBySymbol, settings);
  const elapsedMs = performance.now() - startedAt;
  return {
    fold_backtests: results.length,
    elapsed_ms: elapsedMs,
    ms_per_evaluation: Math.max(elapsedMs / Math.max(results.length, 1), 0.01),
  };
}

export function buildPreflightTimeline(
  datasets: OptimizationDataset[],
  searchData: OptimizationDataset[],
  foldsBySymbol: Map<string, FoldSpec[]>,
  holdout: HoldoutConfig | undefined,
): PreflightSymbolTimeline[] {
  return datasets.map((dataset) => {
    const search = searchData.find((slice) => slice.symbol === dataset.symbol)!;
    const searchCandles = search.candles;
    const folds = foldsBySymbol.get(dataset.symbol) ?? [];
    const holdoutCount = dataset.candles.length - searchCandles.length;
    return {
      ticker: dataset.symbol,
      candle_count: dataset.candles.length,
      search_start_ms: searchCandles[0].timestamp_ms,
      search_end_ms: searchCandles[searchCandles.length - 1].timestamp_ms,
      search_candle_count: searchCandles.length,
      folds: folds.map((fold) => ({
        index: fold.index,
        train_start_ms: searchCandles[fold.trainStartIndex].timestamp_ms,
        train_end_ms: searchCandles[fold.trainEndIndex].timestamp_ms,
        valid_start_ms: searchCandles[fold.validStartIndex].timestamp_ms,
        valid_end_ms: searchCandles[fold.validEndIndex].timestamp_ms,
      })),
      holdout:
        holdout && holdoutCount > 0
          ? {
              start_ms: dataset.candles[searchCandles.length].timestamp_ms,
              end_ms: dataset.candles[dataset.candles.length - 1].timestamp_ms,
              candle_count: holdoutCount,
            }
          : null,
    };
  });
}
