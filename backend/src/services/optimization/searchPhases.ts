import { SeededRandom } from "./random.ts";
import { sampleValues, applyValues } from "./sampler.ts";
import { resolveHalvingConfig, runSuccessiveHalving } from "./successiveHalving.ts";
import { refineSearchSpace, resolveRefinementConfig } from "./coarseToFine.ts";
import {
  createTrial,
  evaluateTrialFully,
  type FullEvaluationContext,
  type TrialFactory,
} from "./trials.ts";
import type { EvaluationPool } from "./evaluationPool.ts";
import type {
  OptimizationConfig,
  OptimizationTrial,
  SearchSpaceNode,
  Strategy,
} from "../../types.ts";

export interface SearchContext {
  config: OptimizationConfig;
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
  factory: TrialFactory;
  evaluation: FullEvaluationContext;
  random: SeededRandom;
  stopRequested: () => boolean;
  pool?: EvaluationPool;
}

export async function runRandomSearch(
  context: SearchContext,
  maxTrials: number,
): Promise<{ trials: OptimizationTrial[]; stoppedEarly: boolean }> {
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

  const { stoppedEarly } = await runSuccessiveHalving(trials, {
    datasets: config.datasets,
    foldsBySymbol: context.evaluation.foldsBySymbol,
    settings: context.evaluation.settings,
    scoring: context.evaluation.scoring,
    halving: resolveHalvingConfig(config.halving),
    stopRequested: context.stopRequested,
    onTrialComplete: context.evaluation.onTrialComplete,
    pool: context.pool,
  });
  return { trials, stoppedEarly };
}

export async function runRefinement(
  context: SearchContext,
  trials: OptimizationTrial[],
  scoredSorted: OptimizationTrial[],
  maxTrials: number,
): Promise<boolean> {
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
      await evaluateTrialFully(trial, context.evaluation);
    } else {
      context.evaluation.onTrialComplete?.(trial);
    }
  }
  return false;
}
