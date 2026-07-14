import { strategyHash } from "./canonical.ts";
import { cheapRejectionReason } from "./cheapRejection.ts";
import { hasCheckpointFolds, takeCheckpointFold } from "./checkpoint.ts";
import { validateCandidate } from "./searchSpace.ts";
import { entrySignalFires } from "../signals.ts";
import { evaluateFold, type EvaluationSettings } from "./evaluate.ts";
import { scoreTrial } from "./scoring.ts";
import { computeComplexity } from "./strategyPaths.ts";
import type {
  BacktestPositionMode,
  FoldSpec,
  OptimizationDataset,
  OptimizationTrial,
  ScoringConfig,
  Strategy,
  TrialValues,
} from "../../types.ts";

export interface TrialFactory {
  nextIndex: number;
  seenHashes: Set<string>;
  positionMode: BacktestPositionMode;
}

export function createTrialFactory(
  positionMode: BacktestPositionMode,
  baselineHash: string,
): TrialFactory {
  return { nextIndex: 0, seenHashes: new Set([baselineHash]), positionMode };
}

export function createTrial(
  factory: TrialFactory,
  strategy: Strategy,
  values: TrialValues,
  phase: "search" | "refine",
  extraValidation?: (strategy: Strategy) => string | null,
): OptimizationTrial {
  const hash = strategyHash(strategy);
  const trial: OptimizationTrial = {
    index: factory.nextIndex++,
    hash,
    values,
    strategy,
    status: "pending",
    stageReached: -1,
    foldResults: [],
    score: null,
    complexity: computeComplexity(strategy),
    phase,
  };

  if (factory.seenHashes.has(hash)) {
    trial.status = "rejected";
    trial.rejectionReason = "duplicate of an earlier candidate";
    return trial;
  }
  const validationError =
    validateCandidate(strategy, factory.positionMode) ??
    cheapRejectionReason(strategy) ??
    extraValidation?.(strategy) ??
    null;
  if (validationError) {
    trial.status = "rejected";
    trial.rejectionReason = validationError;
    return trial;
  }
  factory.seenHashes.add(hash);
  return trial;
}

export interface FullEvaluationContext {
  datasets: OptimizationDataset[];
  foldsBySymbol: Map<string, FoldSpec[]>;
  settings: EvaluationSettings;
  scoring: ScoringConfig;
  finalStage: number;
  onTrialComplete?: (trial: OptimizationTrial) => void;
}

/**
 * One early-exit signal pass per fold window instead of full backtests; a
 * candidate whose entry never fires anywhere can only ever score zero trades.
 * Indicator series computed here land in the shared cache scope, so a
 * surviving candidate's fold backtests reuse them.
 */
function isSignalStarved(trial: OptimizationTrial, context: FullEvaluationContext): boolean {
  for (const dataset of context.datasets) {
    for (const fold of context.foldsBySymbol.get(dataset.symbol) ?? []) {
      const slice = dataset.candles.slice(fold.trainStartIndex, fold.validEndIndex + 1);
      const shared = context.settings.cache?.scope(
        dataset.symbol,
        fold.trainStartIndex,
        fold.validEndIndex,
      );
      if (entrySignalFires(trial.strategy, slice, shared)) {
        return false;
      }
    }
  }
  return true;
}

export function evaluateTrialFully(trial: OptimizationTrial, context: FullEvaluationContext) {
  const checkpoint = context.settings.checkpoint;
  // A candidate with checkpointed folds passed the starvation probe before
  // the interruption, so only unseen candidates need it re-run.
  const checkpointed = hasCheckpointFolds(checkpoint, trial.hash, context.foldsBySymbol);
  if (!checkpointed && isSignalStarved(trial, context)) {
    trial.status = "rejected";
    trial.rejectionReason = "signal-starved: the entry condition never fires on any fold window";
    context.onTrialComplete?.(trial);
    return;
  }
  trial.stageReached = context.finalStage;
  trial.foldResults = [];
  for (const dataset of context.datasets) {
    for (const fold of context.foldsBySymbol.get(dataset.symbol) ?? []) {
      trial.foldResults.push(
        takeCheckpointFold(checkpoint, trial.hash, dataset.symbol, fold.index) ??
          evaluateFold(trial.strategy, dataset, fold, context.settings),
      );
    }
  }
  trial.score = scoreTrial(trial.foldResults, trial.complexity, context.scoring);
  trial.status = "scored";
  context.onTrialComplete?.(trial);
}
