import { spreadFoldSubset } from "./folds.ts";
import { evaluateFold, type EvaluationSettings } from "./evaluate.ts";
import { compareTrialScores, scoreTrial } from "./scoring.ts";
import type {
  FoldEvaluation,
  FoldSpec,
  OptimizationDataset,
  OptimizationTrial,
  ScoringConfig,
  SuccessiveHalvingConfig,
} from "../../types.ts";

export const defaultHalvingConfig: SuccessiveHalvingConfig = {
  stageFoldFractions: [0.34, 0.67, 1],
  promotionRate: 1 / 3,
};

export function resolveHalvingConfig(
  partial?: Partial<SuccessiveHalvingConfig>,
): SuccessiveHalvingConfig {
  return {
    stageFoldFractions:
      partial?.stageFoldFractions ?? defaultHalvingConfig.stageFoldFractions,
    promotionRate: partial?.promotionRate ?? defaultHalvingConfig.promotionRate,
  };
}

export interface HalvingContext {
  datasets: OptimizationDataset[];
  foldsBySymbol: Map<string, FoldSpec[]>;
  settings: EvaluationSettings;
  scoring: ScoringConfig;
  halving: SuccessiveHalvingConfig;
  stopRequested?: () => boolean;
  onEvaluation?: () => void;
}

function evaluateTrialOnSubset(
  trial: OptimizationTrial,
  context: HalvingContext,
  stageFolds: Map<string, FoldSpec[]>,
  cache: Map<string, FoldEvaluation>,
): FoldEvaluation[] {
  const results: FoldEvaluation[] = [];
  for (const dataset of context.datasets) {
    for (const fold of stageFolds.get(dataset.symbol) ?? []) {
      const key = `${trial.hash}:${dataset.symbol}:${fold.index}`;
      let evaluation = cache.get(key);
      if (!evaluation) {
        evaluation = evaluateFold(trial.strategy, dataset, fold, context.settings);
        cache.set(key, evaluation);
      }
      results.push(evaluation);
    }
  }
  return results;
}

export function runSuccessiveHalving(
  trials: OptimizationTrial[],
  context: HalvingContext,
): { stoppedEarly: boolean } {
  const cache = new Map<string, FoldEvaluation>();
  let survivors = trials.filter((trial) => trial.status !== "rejected");
  let stoppedEarly = false;

  const stages = context.halving.stageFoldFractions;
  for (let stage = 0; stage < stages.length; stage += 1) {
    const stageFolds = new Map<string, FoldSpec[]>();
    for (const [symbol, folds] of context.foldsBySymbol) {
      stageFolds.set(symbol, spreadFoldSubset(folds, Math.ceil(folds.length * stages[stage])));
    }

    for (const trial of survivors) {
      if (context.stopRequested?.()) {
        if (trial.score == null) {
          trial.status = "pruned";
          trial.rejectionReason = "runtime budget exhausted";
        }
        stoppedEarly = true;
        continue;
      }
      trial.stageReached = stage;
      trial.foldResults = evaluateTrialOnSubset(trial, context, stageFolds, cache);
      trial.score = scoreTrial(trial.foldResults, trial.complexity, context.scoring);
      context.onEvaluation?.();
    }

    survivors = survivors.filter((trial) => trial.status !== "pruned");
    survivors.sort((left, right) => compareTrialScores(left.score, right.score));

    if (stage < stages.length - 1) {
      const promoted = Math.max(1, Math.ceil(survivors.length * context.halving.promotionRate));
      for (const trial of survivors.slice(promoted)) {
        trial.status = "pruned";
      }
      survivors = survivors.slice(0, promoted);
    }
  }

  for (const trial of survivors) {
    trial.status = "scored";
  }
  return { stoppedEarly };
}
