import { cloneStrategy, setAtPath } from "./strategyPaths.ts";
import type { SeededRandom } from "./random.ts";
import type {
  NumericSearchNode,
  SearchSpaceNode,
  Strategy,
  TrialValues,
} from "../../types.ts";

export function snapToStep(node: NumericSearchNode, raw: number): number {
  const steps = Math.round((raw - node.min) / node.step);
  const snapped = node.min + steps * node.step;
  const clamped = Math.min(node.max, Math.max(node.min, snapped));
  const value = Number(clamped.toFixed(10));
  return node.valueType === "integer" ? Math.round(value) : value;
}

export function sampleNumeric(node: NumericSearchNode, random: SeededRandom): number {
  if (node.scale === "log") {
    const logMin = Math.log(node.min);
    const logMax = Math.log(node.max);
    return snapToStep(node, Math.exp(random.nextInRange(logMin, logMax)));
  }
  return snapToStep(node, random.nextInRange(node.min, node.max));
}

export function sampleValues(nodes: SearchSpaceNode[], random: SeededRandom): TrialValues {
  const values: TrialValues = {};
  for (const node of nodes) {
    if (node.kind === "numeric") {
      values[node.id] = sampleNumeric(node, random);
    } else if (node.kind === "categorical" || node.kind === "operator") {
      values[node.id] = random.pick<number | string>(node.choices);
    } else {
      values[node.id] = random.nextBoolean();
    }
  }
  return values;
}

export function currentValues(nodes: SearchSpaceNode[]): TrialValues {
  const values: TrialValues = {};
  for (const node of nodes) {
    values[node.id] = node.current;
  }
  return values;
}

export function applyValues(
  baseStrategy: Strategy,
  nodes: SearchSpaceNode[],
  values: TrialValues,
): Strategy {
  const candidate = cloneStrategy(baseStrategy);
  for (const node of nodes) {
    const value = values[node.id];
    // Sizing dimensions live on the evaluation settings, not the strategy tree.
    if (value === undefined || node.path[0] === "sizing") {
      continue;
    }
    setAtPath(candidate, node.path, value);
  }
  return candidate;
}
