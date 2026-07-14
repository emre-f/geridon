import { median } from "./scoring.ts";
import type { OptimizationTrial, ParameterStabilityEntry, SearchSpaceNode } from "../../types.ts";

/** Fraction of a dimension's range counted as the best value's neighborhood. */
const neighborhoodFraction = 0.15;

function nodeRange(node: SearchSpaceNode): { min: number; max: number; step: number } | null {
  if (node.kind === "numeric") {
    return { min: node.min, max: node.max, step: node.step };
  }
  if (node.kind === "categorical" && node.choices.length > 1) {
    return { min: Math.min(...node.choices), max: Math.max(...node.choices), step: 0 };
  }
  return null;
}

/**
 * For each searched numeric/curated dimension, how did trials sampled near the
 * best candidate's value score? A neighborhood that keeps scoring well is a
 * robust region; a best value whose neighbors collapse is a lucky spike.
 */
export function computeParameterStability(
  nodes: SearchSpaceNode[],
  scoredTrials: OptimizationTrial[],
  best: OptimizationTrial | undefined,
): ParameterStabilityEntry[] {
  if (!best?.score) {
    return [];
  }
  const entries: ParameterStabilityEntry[] = [];
  for (const node of nodes) {
    const range = nodeRange(node);
    const bestValue = best.values[node.id];
    if (!range || typeof bestValue !== "number") {
      continue;
    }
    const radius = Math.max((range.max - range.min) * neighborhoodFraction, range.step);
    const neighborScores: number[] = [];
    for (const trial of scoredTrials) {
      if (trial.index === best.index || trial.score == null) {
        continue;
      }
      const value = trial.values[node.id];
      if (typeof value === "number" && Math.abs(value - bestValue) <= radius) {
        neighborScores.push(trial.score.score);
      }
    }
    entries.push({
      nodeId: node.id,
      bestValue,
      bestScore: best.score.score,
      neighborCount: neighborScores.length,
      neighborScoreMedian: neighborScores.length > 0 ? median(neighborScores) : null,
      neighborScoreMin: neighborScores.length > 0 ? Math.min(...neighborScores) : null,
    });
  }
  return entries;
}
