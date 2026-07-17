import { SeededRandom } from "../optimization/random.ts";

export const bootstrapConfidenceLevel = 0.95;

export interface HorizonMeans {
  mean: Array<number | null>;
  count: number[];
}

export function meanByHorizon(
  curves: readonly Float64Array[],
  maxHorizon: number,
): HorizonMeans {
  const sums = new Float64Array(maxHorizon);
  const counts = new Array<number>(maxHorizon).fill(0);
  for (const curve of curves) {
    for (let k = 0; k < maxHorizon; k += 1) {
      if (!Number.isNaN(curve[k])) {
        sums[k] += curve[k];
        counts[k] += 1;
      }
    }
  }
  return {
    mean: counts.map((count, k) => (count > 0 ? sums[k] / count : null)),
    count: counts,
  };
}

export function bootstrapGapBand(
  signalCurves: readonly Float64Array[],
  baselineCurves: readonly Float64Array[],
  maxHorizon: number,
  iterations: number,
  rng: SeededRandom,
): { lower: Array<number | null>; upper: Array<number | null> } {
  const eventCount = signalCurves.length;
  const gapSamples: number[][] = Array.from({ length: maxHorizon }, () => []);
  for (let iteration = 0; iteration < (eventCount > 0 ? iterations : 0); iteration += 1) {
    const sampled: Float64Array[] = [];
    const sampledBaseline: Float64Array[] = [];
    for (let draw = 0; draw < eventCount; draw += 1) {
      const index = rng.nextInt(0, eventCount - 1);
      sampled.push(signalCurves[index]);
      sampledBaseline.push(baselineCurves[index]);
    }
    const signal = meanByHorizon(sampled, maxHorizon);
    const baseline = meanByHorizon(sampledBaseline, maxHorizon);
    for (let k = 0; k < maxHorizon; k += 1) {
      if (signal.mean[k] != null && baseline.mean[k] != null) {
        gapSamples[k].push((signal.mean[k] as number) - (baseline.mean[k] as number));
      }
    }
  }

  const tail = (1 - bootstrapConfidenceLevel) / 2;
  const lower: Array<number | null> = [];
  const upper: Array<number | null> = [];
  for (let k = 0; k < maxHorizon; k += 1) {
    const sorted = gapSamples[k].sort((left, right) => left - right);
    lower.push(sorted.length > 0 ? percentile(sorted, tail) : null);
    upper.push(sorted.length > 0 ? percentile(sorted, 1 - tail) : null);
  }
  return { lower, upper };
}

export function percentile(sortedValues: readonly number[], q: number): number {
  const position = q * (sortedValues.length - 1);
  const lowIndex = Math.floor(position);
  const highIndex = Math.ceil(position);
  const weight = position - lowIndex;
  return sortedValues[lowIndex] * (1 - weight) + sortedValues[highIndex] * weight;
}
