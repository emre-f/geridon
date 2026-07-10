import { catalogByKind } from "../indicatorCatalog.ts";
import {
  cloneStrategy,
  collectRules,
  hasActiveRule,
  pathId,
  setAtPath,
} from "./strategyPaths.ts";
import type {
  BacktestPositionMode,
  CategoricalSearchNode,
  IndicatorOperand,
  NumericSearchNode,
  ParameterOverride,
  RuleRole,
  SearchSpaceNode,
  Strategy,
  StrategyRule,
  ToggleSearchNode,
} from "../../types.ts";

export interface CompiledSearchSpace {
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
}

export interface SearchSpaceInputs {
  strategy: Strategy;
  ruleRoles?: Record<string, RuleRole>;
  parameterOverrides?: Record<string, ParameterOverride>;
}

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

function numericNode(
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

function indicatorParameterNodes(
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

function valueThresholdNode(
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

export function compileSearchSpace(inputs: SearchSpaceInputs): CompiledSearchSpace {
  const baseStrategy = cloneStrategy(inputs.strategy);
  const roles = inputs.ruleRoles ?? {};
  const overrides = inputs.parameterOverrides ?? {};
  const nodes: SearchSpaceNode[] = [];

  for (const { path, rule } of collectRules(baseStrategy)) {
    const ruleId = pathId(path);
    const role = roles[ruleId] ?? "required";
    if (role === "off") {
      setAtPath(baseStrategy, [...path, "enabled"], false);
      continue;
    }
    if (role === "optional") {
      const togglePath = [...path, "enabled"];
      const toggle: ToggleSearchNode = {
        id: pathId(togglePath),
        kind: "toggle",
        path: togglePath,
        current: rule.enabled !== false,
      };
      nodes.push(toggle);
    }
    for (const side of ["left", "right"] as const) {
      const operand = rule[side];
      if (operand.type === "indicator") {
        nodes.push(...indicatorParameterNodes(operand, [...path, side], overrides));
      }
    }
    const threshold = valueThresholdNode(rule, "right", path, overrides);
    if (threshold) {
      nodes.push(threshold);
    }
  }

  return { baseStrategy, nodes };
}

export function validateCandidate(
  strategy: Strategy,
  positionMode: BacktestPositionMode,
): string | null {
  for (const { path, rule } of collectRules(strategy)) {
    for (const side of ["left", "right"] as const) {
      const operand = rule[side];
      if (operand.type !== "indicator") {
        continue;
      }
      const implementation = catalogByKind.get(operand.kind);
      if (!implementation) {
        return `${pathId(path)}.${side}: unknown indicator ${operand.kind}`;
      }
      for (const definition of implementation.parameters) {
        const value = operand.parameters[definition.key];
        if (value == null || value < definition.min || value > definition.max) {
          return `${pathId(path)}.${side}.parameters.${definition.key}: out of catalog bounds`;
        }
      }
      const constraintError = implementation.validateParameters?.(operand.parameters);
      if (constraintError) {
        return `${pathId(path)}.${side}: ${constraintError}`;
      }
    }
  }

  if (!hasActiveRule(strategy.entry)) {
    return "entry: at least one active rule is required";
  }
  if (!hasActiveRule(strategy.exit)) {
    return "exit: at least one active rule is required";
  }
  if (positionMode === "three_state" && strategy.cash && !hasActiveRule(strategy.cash)) {
    return "cash: at least one active rule is required for three_state";
  }
  return null;
}
