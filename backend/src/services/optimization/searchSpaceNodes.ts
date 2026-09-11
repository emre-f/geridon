import { catalogByKind } from "../indicatorCatalog.ts";
import { pathId } from "./strategyPaths.ts";
import type {
  CategoricalSearchNode,
  IndicatorOperand,
  NumericSearchNode,
  ParameterOverride,
  SearchSpaceNode,
  SignalOperand,
  StrategyRule,
} from "../../types.ts";

function roundToStep(value: number, min: number, step: number): number {
  const snapped = min + Math.round((value - min) / step) * step;
  return Number(snapped.toFixed(10));
}

function conservativeRange(current: number, min: number, max: number, step: number) {
  const halfSpan = Math.max(Math.abs(current) * 0.5, step * 4);
  const lo = Math.max(min, roundToStep(current - halfSpan, min, step));
  const hi = Math.min(max, roundToStep(current + halfSpan, min, step));
  if (lo >= hi) {
    return { min, max: Math.min(max, min + step * 8) };
  }
  return { min: lo, max: hi };
}

export function numericNode(
  path: string[],
  current: number,
  min: number,
  max: number,
  step: number,
  override: ParameterOverride | undefined,
): NumericSearchNode | CategoricalSearchNode {
  if (override?.choices && override.choices.length > 0) {
    return { id: pathId(path), kind: "categorical", path, choices: override.choices, current };
  }
  const range = conservativeRange(current, min, max, step);
  const finalMin = override?.min ?? range.min;
  const finalMax = override?.max ?? range.max;
  const finalStep = override?.step ?? step;
  return {
    id: pathId(path),
    kind: "numeric",
    path,
    valueType: Number.isInteger(finalStep) && Number.isInteger(finalMin) ? "integer" : "decimal",
    min: finalMin,
    max: Math.max(finalMax, finalMin + finalStep),
    step: finalStep,
    scale: finalMin > 0 && finalMax / finalMin >= 10 ? "log" : "linear",
    current,
  };
}

export function indicatorParameterNodes(
  operand: IndicatorOperand,
  operandPath: string[],
  overrides: Record<string, ParameterOverride>,
): SearchSpaceNode[] {
  const implementation = catalogByKind.get(operand.kind);
  if (!implementation) {
    return [];
  }
  const nodes: SearchSpaceNode[] = [];
  for (const definition of implementation.parameters) {
    const current = operand.parameters[definition.key] ?? definition.default_value;
    const path = [...operandPath, "parameters", definition.key];
    const override = overrides[pathId(path)];
    if (override?.locked) {
      continue;
    }
    nodes.push(numericNode(path, current, definition.min, definition.max, definition.step, override));
  }
  return nodes;
}

function freeValueNode(
  path: string[],
  current: number,
  override: ParameterOverride | undefined,
): SearchSpaceNode {
  const span = Math.max(Math.abs(current) * 0.5, 1);
  const step = span >= 20 ? 1 : Number((span / 20).toPrecision(1));
  return numericNode(path, current, current - span, current + span, step, override);
}

export function valueThresholdNode(
  rule: StrategyRule,
  side: "left" | "right",
  rulePath: string[],
  overrides: Record<string, ParameterOverride>,
): SearchSpaceNode | null {
  const operand = rule[side];
  if (operand.type !== "value") {
    return null;
  }
  const path = [...rulePath, side, "value"];
  const override = overrides[pathId(path)];
  if (override?.locked) {
    return null;
  }
  return freeValueNode(path, operand.value, override);
}

export const signalWindowBounds = { min: 1, max: 250 };

/**
 * A signal operand's tunable dimensions: the count_in_window window and every
 * filter threshold (score and payload keys). Event kind and output are fixed
 * by the strategy and never enter the search space.
 */
export function signalParameterNodes(
  operand: SignalOperand,
  operandPath: string[],
  overrides: Record<string, ParameterOverride>,
): SearchSpaceNode[] {
  const nodes: SearchSpaceNode[] = [];
  if (operand.output === "count_in_window" && operand.window != null) {
    const path = [...operandPath, "window"];
    const override = overrides[pathId(path)];
    if (!override?.locked) {
      nodes.push(
        numericNode(path, operand.window, signalWindowBounds.min, signalWindowBounds.max, 1, override),
      );
    }
  }
  const filterEntries = Object.entries(operand.filters ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [key, current] of filterEntries) {
    const path = [...operandPath, "filters", key];
    const override = overrides[pathId(path)];
    if (!override?.locked) {
      nodes.push(freeValueNode(path, current, override));
    }
  }
  return nodes;
}
