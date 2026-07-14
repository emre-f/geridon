import type {
  NumericSearchNode,
  OperatorSearchNode,
  OptimizationTrial,
  RefinementConfig,
  SearchSpaceNode,
  TrialValues,
} from "../../types.ts";

export const defaultRefinementConfig: RefinementConfig = {
  enabled: true,
  topCount: 8,
  trials: 0,
};

export function resolveRefinementConfig(
  partial: Partial<RefinementConfig> | undefined,
  maxTrials: number,
): RefinementConfig {
  return {
    enabled: partial?.enabled ?? defaultRefinementConfig.enabled,
    topCount: partial?.topCount ?? defaultRefinementConfig.topCount,
    trials: partial?.trials ?? Math.max(4, Math.floor(maxTrials / 4)),
  };
}

export interface RefinedSpace {
  nodes: SearchSpaceNode[];
  frozenValues: TrialValues;
}

function refineNumericNode(
  node: NumericSearchNode,
  topValues: number[],
): NumericSearchNode {
  const lo = Math.min(...topValues);
  const hi = Math.max(...topValues);
  const min = Math.max(node.min, lo - node.step * 2);
  const max = Math.min(node.max, hi + node.step * 2);
  return {
    ...node,
    min,
    max: Math.max(max, min + node.step),
    scale: "linear",
  };
}

/**
 * Narrows each numeric range to the region covered by the top robust trials
 * (not just the single best point) and freezes toggles/categories to their
 * majority value among those trials.
 */
export function refineSearchSpace(
  nodes: SearchSpaceNode[],
  topTrials: OptimizationTrial[],
): RefinedSpace {
  const refined: SearchSpaceNode[] = [];
  const frozenValues: TrialValues = {};

  for (const node of nodes) {
    const values = topTrials
      .map((trial) => trial.values[node.id])
      .filter((value) => value !== undefined);
    if (values.length === 0) {
      refined.push(node);
      continue;
    }

    if (node.kind === "numeric") {
      refined.push(refineNumericNode(node, values as number[]));
      continue;
    }

    if (node.kind === "categorical") {
      const seen = [...new Set(values as number[])];
      if (seen.length > 1) {
        refined.push({ ...node, choices: seen });
      } else {
        frozenValues[node.id] = seen[0];
      }
      continue;
    }

    if (node.kind === "operator") {
      const seen = [...new Set(values as OperatorSearchNode["choices"])];
      if (seen.length > 1) {
        refined.push({ ...node, choices: seen });
      } else {
        frozenValues[node.id] = seen[0];
      }
      continue;
    }

    const trueCount = values.filter((value) => value === true).length;
    frozenValues[node.id] = trueCount * 2 >= values.length;
  }

  return { nodes: refined, frozenValues };
}
