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

/**
 * Block bootstrap: `blocks` groups event indexes that are not independent
 * observations (same ticker-month), and each resample draws whole blocks with
 * replacement. Resampling single events would treat a cluster of overlapping
 * post-event windows as independent evidence and make the band fake-tight.
 */
export function bootstrapGapBand(
  signalCurves: readonly Float64Array[],
  baselineCurves: readonly Float64Array[],
  blocks: readonly (readonly number[])[],
  maxHorizon: number,
  iterations: number,
  rng: SeededRandom,
): { lower: Array<number | null>; upper: Array<number | null> } {
  const gapSamples: number[][] = Array.from({ length: maxHorizon }, () => []);
  for (let iteration = 0; iteration < (blocks.length > 0 ? iterations : 0); iteration += 1) {
    const sampled: Float64Array[] = [];
    const sampledBaseline: Float64Array[] = [];
    for (let draw = 0; draw < blocks.length; draw += 1) {
      for (const index of blocks[rng.nextInt(0, blocks.length - 1)]) {
        sampled.push(signalCurves[index]);
        sampledBaseline.push(baselineCurves[index]);
      }
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

/**
 * t-statistic of the signal-minus-baseline gap per horizon, treating each
 * ticker-month block's mean per-event gap as one observation — the same
 * independence unit as the block bootstrap, so the t-stat cannot be
 * fake-tight where the band is not. Null when fewer than two blocks have data
 * or the block means have zero variance.
 */
export function blockGapTStats(
  signalCurves: readonly Float64Array[],
  baselineCurves: readonly Float64Array[],
  blocks: readonly (readonly number[])[],
  maxHorizon: number,
): Array<number | null> {
  const tStats: Array<number | null> = [];
  for (let k = 0; k < maxHorizon; k += 1) {
    const blockMeans: number[] = [];
    for (const block of blocks) {
      let sum = 0;
      let count = 0;
      for (const index of block) {
        const gap = signalCurves[index][k] - baselineCurves[index][k];
        if (!Number.isNaN(gap)) {
          sum += gap;
          count += 1;
        }
      }
      if (count > 0) {
        blockMeans.push(sum / count);
      }
    }
    if (blockMeans.length < 2) {
      tStats.push(null);
      continue;
    }
    const mean = blockMeans.reduce((total, value) => total + value, 0) / blockMeans.length;
    const variance =
      blockMeans.reduce((total, value) => total + (value - mean) ** 2, 0) /
      (blockMeans.length - 1);
    tStats.push(
      variance > 0 ? mean / Math.sqrt(variance / blockMeans.length) : null,
    );
  }
  return tStats;
}

export function percentile(sortedValues: readonly number[], q: number): number {
  const position = q * (sortedValues.length - 1);
  const lowIndex = Math.floor(position);
  const highIndex = Math.ceil(position);
  const weight = position - lowIndex;
  return sortedValues[lowIndex] * (1 - weight) + sortedValues[highIndex] * weight;
}
