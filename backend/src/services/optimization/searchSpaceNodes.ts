import { catalogByKind } from "../indicatorCatalog.ts";
import { pathId } from "./strategyPaths.ts";
import type {
  CategoricalSearchNode,
  IndicatorOperand,
  NumericSearchNode,
  ParameterOverride,
  SearchSpaceNode,
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
  const span = Math.max(Math.abs(operand.value) * 0.5, 1);
  const step = span >= 20 ? 1 : Number((span / 20).toPrecision(1));
  return numericNode(path, operand.value, operand.value - span, operand.value + span, step, override);
}
