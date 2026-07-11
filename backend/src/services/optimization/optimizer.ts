import { SeededRandom } from "./random.ts";
import { compileSearchSpace } from "./searchSpace.ts";
import { sampleValues, applyValues } from "./sampler.ts";
import { strategyHash } from "./canonical.ts";
import { buildFolds } from "./folds.ts";
import { evaluateBuyHold, evaluateOnFolds, type EvaluationSettings } from "./evaluate.ts";
import { compareTrialScores, median, resolveScoringConfig, scoreTrial, scoringVersion } from "./scoring.ts";
import { resolveHalvingConfig, runSuccessiveHalving } from "./successiveHalving.ts";
import { refineSearchSpace, resolveRefinementConfig } from "./coarseToFine.ts";
import { runAblation } from "./ablation.ts";
import { computeComplexity } from "./strategyPaths.ts";
import { computeParetoFronts } from "./pareto.ts";
import { resolveTpeConfig, runTpeSearch } from "./tpe.ts";
import { resolveEvolutionConfig, runEvolutionSearch } from "./evolution.ts";
import {
  createTrial,
  createTrialFactory,
  evaluateTrialFully,
  type FullEvaluationContext,
  type TrialFactory,
} from "./trials.ts";
import type {
  FoldSpec,
  OptimizationConfig,
  OptimizationControl,
  OptimizationResult,
  OptimizationTrial,
  SearchSpaceNode,
  Strategy,
} from "../../types.ts";

function validateConfig(config: OptimizationConfig) {
  if (config.datasets.length === 0) {
    throw new Error("At least one dataset is required.");
  }
  if (!Number.isInteger(config.maxTrials) || config.maxTrials < 1) {
    throw new Error("max_trials must be a positive integer.");
  }
  if (!Number.isInteger(config.seed)) {
    throw new Error("seed must be an integer.");
  }
}

interface SearchContext {
  config: OptimizationConfig;
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
  factory: TrialFactory;
  evaluation: FullEvaluationContext;
  random: SeededRandom;
  stopRequested: () => boolean;
}

function runRandomSearch(
  context: SearchContext,
  maxTrials: number,
): { trials: OptimizationTrial[]; stoppedEarly: boolean } {
  const { config, baseStrategy, nodes, factory, random } = context;
  const trials: OptimizationTrial[] = [];
  for (let attempt = 0; attempt < maxTrials; attempt += 1) {
    const values = sampleValues(nodes, random);
    const trial = createTrial(factory, applyValues(baseStrategy, nodes, values), values, "search");
    trials.push(trial);
    if (trial.status === "rejected") {
      context.evaluation.onTrialComplete?.(trial);
    }
  }

  const { stoppedEarly } = runSuccessiveHalving(trials, {
    datasets: config.datasets,
    foldsBySymbol: context.evaluation.foldsBySymbol,
    settings: context.evaluation.settings,
    scoring: context.evaluation.scoring,
    halving: resolveHalvingConfig(config.halving),
    stopRequested: context.stopRequested,
    onTrialComplete: context.evaluation.onTrialComplete,
  });
  return { trials, stoppedEarly };
}

function runRefinement(
  context: SearchContext,
  trials: OptimizationTrial[],
  scoredSorted: OptimizationTrial[],
  maxTrials: number,
) {
  const refinement = resolveRefinementConfig(context.config.refinement, context.config.maxTrials);
  if (!refinement.enabled || maxTrials < 1 || scoredSorted.length === 0) {
    return false;
  }
  const refined = refineSearchSpace(context.nodes, scoredSorted.slice(0, refinement.topCount));
  for (let i = 0; i < maxTrials; i += 1) {
    if (context.stopRequested()) {
      return true;
    }
    const values = { ...refined.frozenValues, ...sampleValues(refined.nodes, context.random) };
    const trial = createTrial(
      context.factory,
      applyValues(context.baseStrategy, context.nodes, values),
      values,
      "refine",
    );
    trials.push(trial);
    if (trial.status !== "rejected") {
      evaluateTrialFully(trial, context.evaluation);
    } else {
      context.evaluation.onTrialComplete?.(trial);
    }
  }
  return false;
}

export function runOptimization(
  config: OptimizationConfig,
  control?: OptimizationControl,
): OptimizationResult {
  validateConfig(config);
  const method = config.method ?? "random";
  const scoring = resolveScoringConfig(config.scoring);
  const settings: EvaluationSettings = {
    positionMode: config.positionMode,
    buyPercent: config.buyPercent,
    sellPercent: config.sellPercent,
    initialCapital: config.initialCapital,
    costs: config.costs,
    objective: scoring.objective,
  };
  const deadlineMs = config.maxRuntimeMs != null ? Date.now() + config.maxRuntimeMs : undefined;
  const stopRequested = () =>
    (deadlineMs != null && Date.now() > deadlineMs) || (control?.shouldStop?.() ?? false);
  let completedCount = 0;
  const completedTrialIndexes = new Set<number>();
  const onTrialComplete = (trial: OptimizationTrial) => {
    if (completedTrialIndexes.has(trial.index)) return;
    completedTrialIndexes.add(trial.index);
    completedCount += 1;
    control?.onTrialComplete?.(completedCount);
  };

  const foldsBySymbol = new Map<string, FoldSpec[]>();
  for (const dataset of config.datasets) {
    foldsBySymbol.set(dataset.symbol, buildFolds(dataset.candles.length, config.folds));
  }

  const baselineFolds = evaluateOnFolds(config.strategy, config.datasets, foldsBySymbol, settings);
  const baselineComplexity = computeComplexity(config.strategy);
  const baseline = {
    foldResults: baselineFolds,
    score: scoreTrial(baselineFolds, baselineComplexity, scoring),
    complexity: baselineComplexity,
  };

  const buyHoldFolds = evaluateBuyHold(config.datasets, foldsBySymbol, settings);
  const buyHold = {
    foldResults: buyHoldFolds,
    medianObjective: median(buyHoldFolds.map((fold) => fold.objectiveValue ?? 0)),
  };

  const { baseStrategy, nodes } = compileSearchSpace(config);
  const halving = resolveHalvingConfig(config.halving);
  const context: SearchContext = {
    config,
    baseStrategy,
    nodes,
    factory: createTrialFactory(config.positionMode, strategyHash(config.strategy)),
    evaluation: {
      datasets: config.datasets,
      foldsBySymbol,
      settings,
      scoring,
      finalStage: halving.stageFoldFractions.length - 1,
      onTrialComplete,
    },
    random: new SeededRandom(config.seed),
    stopRequested,
  };

  let searchOutcome: { trials: OptimizationTrial[]; stoppedEarly: boolean };
  const refinement = resolveRefinementConfig(config.refinement, config.maxTrials);
  const refinementTrials = method !== "evolution" && refinement.enabled
    ? Math.min(refinement.trials, Math.max(0, config.maxTrials - 1))
    : 0;
  const searchTrials = config.maxTrials - refinementTrials;
  if (method === "tpe") {
    searchOutcome = runTpeSearch({
      ...context,
      config: resolveTpeConfig(config.tpe),
      maxTrials: searchTrials,
    });
  } else if (method === "evolution") {
    searchOutcome = runEvolutionSearch({
      ...context,
      config: resolveEvolutionConfig(config.evolution, baseStrategy),
      maxTrials: config.maxTrials,
    });
  } else {
    searchOutcome = runRandomSearch(context, searchTrials);
  }
  const { trials } = searchOutcome;
  let stoppedEarly = searchOutcome.stoppedEarly;

  const scoredSorted = () =>
    trials
      .filter((trial) => trial.status === "scored" && trial.score != null)
      .sort((left, right) => compareTrialScores(left.score, right.score));

  if (method !== "evolution" && !stoppedEarly) {
    stoppedEarly = runRefinement(context, trials, scoredSorted(), refinementTrials);
  }

  const leaderboard = scoredSorted();
  const best = leaderboard[0];
  const ablation = best
    ? runAblation(best.strategy, best.score!, {
        datasets: config.datasets,
        foldsBySymbol,
        settings,
        scoring,
      })
    : [];

  return {
    scoringVersion,
    seed: config.seed,
    method,
    space: nodes,
    baseline,
    buyHold,
    trials,
    leaderboard,
    ablation,
    paretoFronts: computeParetoFronts(trials),
    stoppedEarly,
  };
}
