import { applyValues, sampleValues, snapToStep } from "./sampler.ts";
import { createTrial, evaluateTrialFully, type FullEvaluationContext, type TrialFactory } from "./trials.ts";
import type { SeededRandom } from "./random.ts";
import type {
  NumericSearchNode,
  OptimizationTrial,
  SampledValue,
  SearchSpaceNode,
  Strategy,
  TpeConfig,
  TrialValues,
} from "../../types.ts";

export const defaultTpeConfig: TpeConfig = {
  gamma: 0.25,
  startupTrials: 8,
  candidateCount: 24,
};

export function resolveTpeConfig(partial?: Partial<TpeConfig>): TpeConfig {
  return { ...defaultTpeConfig, ...partial };
}

interface Observation {
  values: TrialValues;
  score: number;
}

function gaussianMixtureDensity(
  x: number,
  means: number[],
  bandwidth: number,
  rangeMin: number,
  rangeMax: number,
): number {
  const uniform = 1 / Math.max(rangeMax - rangeMin, Number.EPSILON);
  let density = uniform;
  for (const mean of means) {
    const z = (x - mean) / bandwidth;
    density += Math.exp(-0.5 * z * z) / (bandwidth * Math.sqrt(2 * Math.PI));
  }
  return density / (means.length + 1);
}

function bandwidthFor(node: NumericSearchNode, count: number): number {
  const range = node.max - node.min;
  return Math.max(node.step, range / (3 * Math.sqrt(count + 1)));
}

/**
 * Univariate Tree-structured Parzen Estimator: models good and bad completed
 * trials per parameter and proposes the candidate maximizing the good/bad
 * density ratio. Falls back to pure random sampling during startup.
 */
export class TpeSampler {
  private readonly observations: Observation[] = [];
  private readonly nodes: SearchSpaceNode[];
  private readonly random: SeededRandom;
  private readonly config: TpeConfig;

  constructor(nodes: SearchSpaceNode[], random: SeededRandom, config: TpeConfig) {
    this.nodes = nodes;
    this.random = random;
    this.config = config;
  }

  observe(values: TrialValues, score: number) {
    this.observations.push({ values, score });
  }

  private split(): { good: Observation[]; bad: Observation[] } {
    const sorted = [...this.observations].sort((left, right) => right.score - left.score);
    const goodCount = Math.max(1, Math.ceil(sorted.length * this.config.gamma));
    return { good: sorted.slice(0, goodCount), bad: sorted.slice(goodCount) };
  }

  private sampleNumericNode(
    node: NumericSearchNode,
    good: Observation[],
    bad: Observation[],
  ): number {
    const goodValues = good.map((entry) => entry.values[node.id] as number);
    const badValues = bad.map((entry) => entry.values[node.id] as number);
    const goodBandwidth = bandwidthFor(node, goodValues.length);
    const badBandwidth = bandwidthFor(node, badValues.length);

    let best: number | null = null;
    let bestRatio = -Infinity;
    for (let i = 0; i < this.config.candidateCount; i += 1) {
      const mean = this.random.pick(goodValues);
      const raw = this.random.nextGaussian(mean, goodBandwidth);
      const candidate = snapToStep(node, raw);
      const goodDensity = gaussianMixtureDensity(
        candidate, goodValues, goodBandwidth, node.min, node.max,
      );
      const badDensity = gaussianMixtureDensity(
        candidate, badValues, badBandwidth, node.min, node.max,
      );
      const ratio = goodDensity / Math.max(badDensity, Number.EPSILON);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    }
    return best!;
  }

  private sampleDiscreteNode(
    choices: SampledValue[],
    nodeId: string,
    good: Observation[],
    bad: Observation[],
  ): SampledValue {
    const weight = (observations: Observation[], choice: SampledValue) =>
      (observations.filter((entry) => entry.values[nodeId] === choice).length + 1) /
      (observations.length + choices.length);

    const goodWeights = choices.map((choice) => weight(good, choice));
    const totalGoodWeight = goodWeights.reduce((sum, value) => sum + value, 0);

    let best: SampledValue = choices[0];
    let bestRatio = -Infinity;
    for (let i = 0; i < this.config.candidateCount; i += 1) {
      let pick = this.random.next() * totalGoodWeight;
      let chosen = choices[0];
      for (let index = 0; index < choices.length; index += 1) {
        pick -= goodWeights[index];
        if (pick <= 0) {
          chosen = choices[index];
          break;
        }
      }
      const ratio = weight(good, chosen) / weight(bad, chosen);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = chosen;
      }
    }
    return best;
  }

  sample(): TrialValues {
    if (this.observations.length < this.config.startupTrials) {
      return sampleValues(this.nodes, this.random);
    }
    const { good, bad } = this.split();
    const values: TrialValues = {};
    for (const node of this.nodes) {
      if (node.kind === "numeric") {
        values[node.id] = this.sampleNumericNode(node, good, bad);
      } else if (node.kind === "categorical") {
        values[node.id] = this.sampleDiscreteNode(node.choices, node.id, good, bad);
      } else {
        values[node.id] = this.sampleDiscreteNode([true, false], node.id, good, bad);
      }
    }
    return values;
  }
}

export interface TpeSearchContext {
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
  factory: TrialFactory;
  evaluation: FullEvaluationContext;
  config: TpeConfig;
  random: SeededRandom;
  maxTrials: number;
  stopRequested?: () => boolean;
}

export function runTpeSearch(
  context: TpeSearchContext,
): { trials: OptimizationTrial[]; stoppedEarly: boolean } {
  const sampler = new TpeSampler(context.nodes, context.random, context.config);
  const trials: OptimizationTrial[] = [];
  let evaluated = 0;
  let attempts = 0;
  let stoppedEarly = false;

  while (attempts < context.maxTrials) {
    if (context.stopRequested?.()) {
      stoppedEarly = true;
      break;
    }
    attempts += 1;

    const values = sampler.sample();
    const strategy = applyValues(context.baseStrategy, context.nodes, values);
    const trial = createTrial(context.factory, strategy, values, "search");
    trials.push(trial);
    if (trial.status === "rejected") {
      context.evaluation.onTrialComplete?.(trial);
      continue;
    }

    evaluateTrialFully(trial, context.evaluation);
    if (trial.status !== "scored" || trial.score == null) {
      continue;
    }
    sampler.observe(values, trial.score.score);
    evaluated += 1;
  }

  return { trials, stoppedEarly };
}
