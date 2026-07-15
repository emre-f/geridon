import { SeededRandom } from "./random.ts";
import { compileSearchSpace } from "./searchSpace.ts";
import { strategyHash } from "./canonical.ts";
import { createFoldCheckpoint } from "./checkpoint.ts";
import { buildFolds } from "./folds.ts";
import { evaluateBuyHold, evaluateOnFolds, withSizing, type EvaluationSettings } from "./evaluate.ts";
import { createIndicatorSeriesCache } from "./indicatorCache.ts";
import { compareTrialScores, median, resolveScoringConfig, scoreTrial, scoringVersion } from "./scoring.ts";
import { resolveHalvingConfig } from "./successiveHalving.ts";
import { resolveRefinementConfig } from "./coarseToFine.ts";
import { runAblation } from "./ablation.ts";
import { computeRuleInclusion } from "./inclusion.ts";
import { computeParameterStability } from "./stability.ts";
import { computeComplexity } from "./strategyPaths.ts";
import { computeParetoFronts } from "./pareto.ts";
import { resolveTpeConfig, runTpeSearch } from "./tpe.ts";
import { resolveEvolutionConfig, runEvolutionSearch } from "./evolution.ts";
import { runRandomSearch, runRefinement, type SearchContext } from "./searchPhases.ts";
import { createEvaluationPool, type EvaluationPool } from "./evaluationPool.ts";
import { createTrialFactory } from "./trials.ts";
import type {
  FoldSpec,
  OptimizationConfig,
  OptimizationControl,
  OptimizationResult,
  OptimizationTrial,
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

export async function runOptimization(
  config: OptimizationConfig,
  control?: OptimizationControl,
): Promise<OptimizationResult> {
  validateConfig(config);
  const workerCount = Math.max(1, Math.floor(config.workerCount ?? 1));
  const pool: EvaluationPool | undefined =
    workerCount > 1
      ? createEvaluationPool(
          config.datasets,
          {
            positionMode: config.positionMode,
            initialCapital: config.initialCapital,
            costs: config.costs,
            objective: resolveScoringConfig(config.scoring).objective,
          },
          workerCount,
          config.cache?.maxValues,
        )
      : undefined;
  try {
    return await runSearch(config, control, pool);
  } finally {
    await pool?.close();
  }
}

async function runSearch(
  config: OptimizationConfig,
  control: OptimizationControl | undefined,
  pool: EvaluationPool | undefined,
): Promise<OptimizationResult> {
  const method = config.method ?? "random";
  const scoring = resolveScoringConfig(config.scoring);
  const checkpoint = createFoldCheckpoint(config.checkpoint);
  const settings: EvaluationSettings = {
    positionMode: config.positionMode,
    buyPercent: config.buyPercent,
    sellPercent: config.sellPercent,
    initialCapital: config.initialCapital,
    costs: config.costs,
    objective: scoring.objective,
    cache:
      config.cache?.enabled === false
        ? undefined
        : createIndicatorSeriesCache(config.cache?.maxValues),
    checkpoint,
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
    control?.onTrialFinished?.(trial);
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
  control?.onBaseline?.(baseline.score.score);

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
      pool,
    },
    random: new SeededRandom(config.seed),
    stopRequested,
    pool,
  };

  let searchOutcome: { trials: OptimizationTrial[]; stoppedEarly: boolean };
  const refinement = resolveRefinementConfig(config.refinement, config.maxTrials);
  const refinementTrials = method !== "evolution" && refinement.enabled
    ? Math.min(refinement.trials, Math.max(0, config.maxTrials - 1))
    : 0;
  const searchTrials = config.maxTrials - refinementTrials;
  if (method === "tpe") {
    searchOutcome = await runTpeSearch({
      ...context,
      config: resolveTpeConfig(config.tpe),
      maxTrials: searchTrials,
    });
  } else if (method === "evolution") {
    searchOutcome = await runEvolutionSearch({
      ...context,
      config: resolveEvolutionConfig(config.evolution, baseStrategy),
      maxTrials: config.maxTrials,
    });
  } else {
    searchOutcome = await runRandomSearch(context, searchTrials);
  }
  const { trials } = searchOutcome;
  let stoppedEarly = searchOutcome.stoppedEarly;

  const scoredSorted = () =>
    trials
      .filter((trial) => trial.status === "scored" && trial.score != null)
      .sort((left, right) => compareTrialScores(left.score, right.score));

  if (method !== "evolution" && !stoppedEarly) {
    stoppedEarly = await runRefinement(context, trials, scoredSorted(), refinementTrials);
  }

  const leaderboard = scoredSorted();
  const best = leaderboard[0];
  const ablation = best
    ? runAblation(best.strategy, best.score!, {
        datasets: config.datasets,
        foldsBySymbol,
        settings: withSizing(settings, best.sizing),
        scoring,
      })
    : [];

  const structureSearched = method === "evolution" || nodes.some((node) => node.kind === "toggle");
  const inclusion = structureSearched ? computeRuleInclusion(leaderboard, config.strategy) : [];

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
    inclusion,
    paretoFronts: computeParetoFronts(trials),
    stability: computeParameterStability(nodes, leaderboard, best),
    checkpointFoldsReused: checkpoint?.hits ?? 0,
    stoppedEarly,
  };
}
