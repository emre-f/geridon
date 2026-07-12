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

/**
 * One scatter panel per numeric/categorical search node: score vs sampled
 * value across all fully scored trials. Panels where every trial sampled the
 * same value carry no sensitivity signal and are dropped.
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
      points,
    });
  }

  return panels;
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
