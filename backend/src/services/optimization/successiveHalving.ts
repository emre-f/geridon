import { takeCheckpointFold } from "./checkpoint.ts";
import { spreadFoldSubset } from "./folds.ts";
import { evaluateFold, withSizing, type EvaluationSettings } from "./evaluate.ts";
import type { EvaluationPool, PoolFoldTask } from "./evaluationPool.ts";
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
  onTrialComplete?: (trial: OptimizationTrial) => void;
  /** Present only when worker_count > 1; fold backtests then run in parallel. */
  pool?: EvaluationPool;
}

/** One (trial, dataset, fold) slot resolved from cache/checkpoint or a pooled task. */
interface StageSlot {
  trial: OptimizationTrial;
  key: string;
  resolved: FoldEvaluation | null;
  taskIndex: number;
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
        evaluation =
          takeCheckpointFold(context.settings.checkpoint, trial.hash, dataset.symbol, fold.index) ??
          evaluateFold(trial.strategy, dataset, fold, withSizing(context.settings, trial.sizing));
        cache.set(key, evaluation);
      }
      results.push(evaluation);
    }
  }
  return results;
}

/** Pruning applied when the runtime budget runs out before a stage completes. */
function pruneForBudget(survivors: OptimizationTrial[]) {
  for (const trial of survivors) {
    if (trial.score == null) {
      trial.status = "pruned";
      trial.rejectionReason = "runtime budget exhausted";
    }
  }
}

/**
 * Evaluate a whole stage across the worker pool: cache/checkpoint hits resolve
 * on the main thread (so reuse and determinism are identical to the inline
 * path), and only true misses are dispatched as parallel fold backtests.
 */
async function evaluateStagePooled(
  survivors: OptimizationTrial[],
  context: HalvingContext,
  stageFolds: Map<string, FoldSpec[]>,
  cache: Map<string, FoldEvaluation>,
  stage: number,
): Promise<boolean> {
  if (context.stopRequested?.()) {
    pruneForBudget(survivors);
    return true;
  }
  const slots: StageSlot[] = [];
  const tasks: PoolFoldTask[] = [];
  for (const trial of survivors) {
    trial.stageReached = stage;
    const sized = withSizing(context.settings, trial.sizing);
    for (const dataset of context.datasets) {
      for (const fold of stageFolds.get(dataset.symbol) ?? []) {
        const key = `${trial.hash}:${dataset.symbol}:${fold.index}`;
        const resolved =
          cache.get(key) ??
          takeCheckpointFold(context.settings.checkpoint, trial.hash, dataset.symbol, fold.index) ??
          null;
        const slot: StageSlot = { trial, key, resolved, taskIndex: -1 };
        if (!resolved) {
          slot.taskIndex = tasks.length;
          tasks.push({
            strategy: trial.strategy,
            buyPercent: sized.buyPercent,
            sellPercent: sized.sellPercent,
            symbol: dataset.symbol,
            fold,
          });
        }
        slots.push(slot);
      }
    }
  }

  const evaluated = await context.pool!.map(tasks);
  const byTrial = new Map<OptimizationTrial, FoldEvaluation[]>();
  for (const slot of slots) {
    const value = slot.resolved ?? evaluated[slot.taskIndex];
    cache.set(slot.key, value);
    const list = byTrial.get(slot.trial) ?? [];
    list.push(value);
    byTrial.set(slot.trial, list);
  }
  for (const trial of survivors) {
    trial.foldResults = byTrial.get(trial) ?? [];
    trial.score = scoreTrial(trial.foldResults, trial.complexity, context.scoring);
  }
  return false;
}

export async function runSuccessiveHalving(
  trials: OptimizationTrial[],
  context: HalvingContext,
): Promise<{ stoppedEarly: boolean }> {
  const cache = new Map<string, FoldEvaluation>();
  let survivors = trials.filter((trial) => trial.status !== "rejected");
  let stoppedEarly = false;

  const stages = context.halving.stageFoldFractions;
  for (let stage = 0; stage < stages.length; stage += 1) {
    const stageFolds = new Map<string, FoldSpec[]>();
    for (const [symbol, folds] of context.foldsBySymbol) {
      stageFolds.set(symbol, spreadFoldSubset(folds, Math.ceil(folds.length * stages[stage])));
    }

    if (context.pool) {
      stoppedEarly = (await evaluateStagePooled(survivors, context, stageFolds, cache, stage)) ||
        stoppedEarly;
    } else {
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
      }
    }

    survivors = survivors.filter((trial) => trial.status !== "pruned");
    survivors.sort((left, right) => compareTrialScores(left.score, right.score));

    if (stage < stages.length - 1) {
      const promoted = Math.max(1, Math.ceil(survivors.length * context.halving.promotionRate));
      for (const trial of survivors.slice(promoted)) {
        trial.status = "pruned";
        context.onTrialComplete?.(trial);
      }
      survivors = survivors.slice(0, promoted);
    }
  }

  for (const trial of survivors) {
    trial.status = "scored";
    context.onTrialComplete?.(trial);
  }
  return { stoppedEarly };
}
