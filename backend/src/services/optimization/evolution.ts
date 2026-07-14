import {
  identityGenome,
  materializeGenome,
  mutateGenome,
  sideComplexityCeiling,
  validateCaps,
  type EvolutionGenome,
} from "./evolutionGenome.ts";
import { createTrial, evaluateTrialFully, type FullEvaluationContext, type TrialFactory } from "./trials.ts";
import { compareTrialScores } from "./scoring.ts";
import type { SeededRandom } from "./random.ts";
import type {
  EvolutionSearchConfig,
  OptimizationTrial,
  SearchSpaceNode,
  Strategy,
} from "../../types.ts";

/** The plan's suggested caps; applied when the user does not set explicit ones. */
export const evolutionCapDefaults = {
  maxNewRulesPerSide: 2,
  maxActiveRulesPerSide: 6,
  maxUniqueIndicatorsPerSide: 4,
  maxTreeDepth: 3,
};

/** Hard ceilings for user-supplied evolution settings. */
export const evolutionLimits = {
  maxRuleLibrary: 24,
  maxInsertionPoints: 12,
  maxNewRulesPerSide: 4,
  maxActiveRulesPerSide: 12,
  maxUniqueIndicatorsPerSide: 8,
  maxTreeDepth: 7,
  maxPopulation: 64,
};

export function isInsertableGroup(strategy: Strategy, pointId: string): boolean {
  let node: unknown = strategy;
  for (const segment of pointId.split(".")) {
    if (node == null || typeof node !== "object") {
      return false;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  const group = node as { type?: string; operator?: string; enabled?: boolean } | undefined;
  return (
    group?.type === "group" &&
    (group.operator === "and" || group.operator === "or") &&
    group.enabled !== false
  );
}

/** Suggested caps raised where needed so they never exclude the baseline itself. */
export function baselineEvolutionCaps(strategy: Strategy) {
  const ceiling = sideComplexityCeiling(strategy);
  return {
    maxNewRulesPerSide: evolutionCapDefaults.maxNewRulesPerSide,
    maxActiveRulesPerSide: Math.max(
      evolutionCapDefaults.maxActiveRulesPerSide,
      ceiling.activeRules,
    ),
    maxUniqueIndicatorsPerSide: Math.max(
      evolutionCapDefaults.maxUniqueIndicatorsPerSide,
      ceiling.uniqueIndicators,
    ),
    maxTreeDepth: Math.max(evolutionCapDefaults.maxTreeDepth, ceiling.depth),
  };
}

export function resolveEvolutionConfig(
  partial: Partial<EvolutionSearchConfig> | undefined,
  strategy: Strategy,
): EvolutionSearchConfig {
  const requested =
    partial?.insertionPoints ?? (["entry", "exit", "cash"] as const).map(String);
  const insertionPoints = requested.filter((pointId) => isInsertableGroup(strategy, pointId));
  return {
    populationSize: 12,
    eliteCount: 4,
    ruleLibrary: [],
    ...baselineEvolutionCaps(strategy),
    ...partial,
    insertionPoints,
  };
}

export interface EvolutionSearchContext {
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
  factory: TrialFactory;
  evaluation: FullEvaluationContext;
  config: EvolutionSearchConfig;
  random: SeededRandom;
  maxTrials: number;
  stopRequested?: () => boolean;
}

export function runEvolutionSearch(
  context: EvolutionSearchContext,
): { trials: OptimizationTrial[]; stoppedEarly: boolean } {
  const { baseStrategy, nodes, factory, evaluation, config, random, maxTrials } = context;
  const trials: OptimizationTrial[] = [];
  const population: Array<{ trial: OptimizationTrial; genome: EvolutionGenome }> = [];
  const identity = identityGenome(nodes);
  const mutationContext = { nodes, baseStrategy, config, random };

  let evaluated = 0;
  let attempts = 0;
  let stoppedEarly = false;

  while (attempts < maxTrials) {
    if (context.stopRequested?.()) {
      stoppedEarly = true;
      break;
    }
    attempts += 1;

    let parent = identity;
    if (population.length > 0 && evaluated >= config.populationSize) {
      const elites = [...population]
        .sort((left, right) => compareTrialScores(left.trial.score, right.trial.score))
        .slice(0, config.eliteCount);
      parent = random.pick(elites).genome;
    }

    const genome = mutateGenome(parent, mutationContext);
    const strategy = materializeGenome(baseStrategy, nodes, genome, config);
    const trial = createTrial(factory, strategy, genome.values, "search", (candidate) =>
      validateCaps(candidate, config),
    );
    trials.push(trial);
    if (trial.status === "rejected") {
      evaluation.onTrialComplete?.(trial);
      continue;
    }

    evaluateTrialFully(trial, evaluation);
    if (trial.status !== "scored") {
      continue;
    }
    evaluated += 1;
    population.push({ trial, genome });
  }

  return { trials, stoppedEarly };
}
