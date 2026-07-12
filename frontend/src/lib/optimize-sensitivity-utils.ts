import type { OptimizationTrialRecord } from "@/lib/api-optimization-experiment-types";
import type { SearchSpaceNode } from "@/lib/api-optimization-types";
import { nodeLabel } from "./optimize-chart-utils.ts";

export interface SensitivityPoint {
  trialIndex: number;
  value: number;
  score: number;
  eligible: boolean;
}

export interface SensitivityPanel {
  nodeId: string;
  label: string;
  current: number;
  min: number;
  max: number;
  /** Spread of mean score across value bins: how much this parameter moved the score. */
  impact: number;
  points: SensitivityPoint[];
}

function nodeBounds(node: SearchSpaceNode): { min: number; max: number } | null {
  if (node.kind === "numeric") {
    return { min: node.min, max: node.max };
  }
  if (node.kind === "categorical" && node.choices.length > 0) {
    return { min: Math.min(...node.choices), max: Math.max(...node.choices) };
  }
  return null;
}

function panelImpact(points: SensitivityPoint[]): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const distinct = new Set(sorted.map((point) => point.value)).size;
  const binCount = Math.min(4, distinct);
  const means: number[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * sorted.length) / binCount);
    const end = Math.floor(((bin + 1) * sorted.length) / binCount);
    const slice = sorted.slice(start, end);
    if (slice.length > 0) {
      means.push(slice.reduce((sum, point) => sum + point.score, 0) / slice.length);
    }
  }
  return means.length < 2 ? 0 : Math.max(...means) - Math.min(...means);
}

/**
 * One scatter panel per numeric/categorical search node: score vs sampled
 * value across all fully scored trials, sorted so the parameters that moved
 * the score most come first. Panels where every trial sampled the same value
 * carry no sensitivity signal and are dropped.
 */
export function sensitivityPanels(
  space: SearchSpaceNode[],
  trials: OptimizationTrialRecord[],
): SensitivityPanel[] {
  const scored = trials.filter((trial) => trial.status === "scored" && trial.score != null);
  const panels: SensitivityPanel[] = [];

  for (const node of space) {
    const bounds = nodeBounds(node);
    if (!bounds || typeof node.current !== "number") {
      continue;
    }
    const points: SensitivityPoint[] = [];
    for (const trial of scored) {
      const value = trial.values[node.id];
      if (typeof value !== "number") {
        continue;
      }
      points.push({
        trialIndex: trial.trial_index,
        value,
        score: trial.score!.score,
        eligible: trial.score!.eligible,
      });
    }
    if (new Set(points.map((point) => point.value)).size < 2) {
      continue;
    }
    const values = points.map((point) => point.value);
    panels.push({
      nodeId: node.id,
      label: nodeLabel(node),
      current: node.current,
      min: Math.min(bounds.min, node.current, ...values),
      max: Math.max(bounds.max, node.current, ...values),
      impact: panelImpact(points),
      points,
    });
  }

  return panels.sort((a, b) => b.impact - a.impact);
}

/** Shared score domain so every panel is read against the same y scale. */
export function sensitivityScoreDomain(
  panels: SensitivityPanel[],
  baselineScore: number | null,
): { min: number; max: number } | null {
  const scores = panels.flatMap((panel) => panel.points.map((point) => point.score));
  if (baselineScore != null) {
    scores.push(baselineScore);
  }
  if (scores.length === 0) {
    return null;
  }
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const pad = (max - min || Math.abs(max) || 1) * 0.1;
  return { min: min - pad, max: max + pad };
}
