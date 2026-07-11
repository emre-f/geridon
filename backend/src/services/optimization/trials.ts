import { strategyHash } from "./canonical.ts";
import { validateCandidate } from "./searchSpace.ts";
import { evaluateOnFolds, type EvaluationSettings } from "./evaluate.ts";
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
    validateCandidate(strategy, factory.positionMode) ?? extraValidation?.(strategy) ?? null;
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

export function evaluateTrialFully(trial: OptimizationTrial, context: FullEvaluationContext) {
  trial.stageReached = context.finalStage;
  trial.foldResults = evaluateOnFolds(
    trial.strategy,
    context.datasets,
    context.foldsBySymbol,
    context.settings,
  );
  trial.score = scoreTrial(trial.foldResults, trial.complexity, context.scoring);
  trial.status = "scored";
  context.onTrialComplete?.(trial);
}
