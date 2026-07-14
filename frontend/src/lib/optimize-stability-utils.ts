import type { ParameterStabilityEntry, SearchSpaceNode } from "@/lib/api-optimization-types";
import { nodeLabel } from "./optimize-chart-utils.ts";

export type StabilityVerdict = "robust" | "spiky" | "sparse";

export interface StabilityRow {
  nodeId: string;
  label: string;
  bestValue: number;
  neighborCount: number;
  neighborScoreMedian: number | null;
  verdict: StabilityVerdict;
}

const minNeighborsForVerdict = 3;

/**
 * Classifies the best candidate's neighborhood per searched dimension: with a
 * handful of nearby samples, a neighborhood whose median score still beats the
 * baseline is a robust region; one that falls back to (or below) the baseline
 * suggests the best value is a lucky spike.
 */
export function stabilityRows(
  entries: ParameterStabilityEntry[],
  space: SearchSpaceNode[],
  baselineScore: number | null,
): StabilityRow[] {
  const nodesById = new Map(space.map((node) => [node.id, node]));
  return entries.map((entry) => {
    const node = nodesById.get(entry.nodeId);
    let verdict: StabilityVerdict = "sparse";
    if (entry.neighborCount >= minNeighborsForVerdict && entry.neighborScoreMedian != null) {
      verdict =
        baselineScore == null || entry.neighborScoreMedian > baselineScore ? "robust" : "spiky";
    }
    return {
      nodeId: entry.nodeId,
      label: node ? nodeLabel(node) : entry.nodeId,
      bestValue: entry.bestValue,
      neighborCount: entry.neighborCount,
      neighborScoreMedian: entry.neighborScoreMedian,
      verdict,
    };
  });
}
