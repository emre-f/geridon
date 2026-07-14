import { catalogByKind } from "../indicatorCatalog.ts";
import { comparisonOperators } from "../strategyValidationHelpers.ts";
import { indicatorParameterNodes, valueThresholdNode } from "./searchSpaceNodes.ts";
import { sizingSearchNodes, type SizingSpaceInputs } from "./sizingSpace.ts";
import {
  cloneStrategy,
  collectAtLeastGroups,
  collectRules,
  hasActiveRule,
  pathId,
  setAtPath,
} from "./strategyPaths.ts";
import type {
  BacktestPositionMode,
  NumericSearchNode,
  OperatorSearchNode,
  ParameterOverride,
  RuleRole,
  SearchSpaceNode,
  Strategy,
  StructureSearchConfig,
  ToggleSearchNode,
} from "../../types.ts";

export { sizingFromValues, sizingHardBounds, sizingNodeIds, sizingSearchNodes } from "./sizingSpace.ts";

/**
 * Bump when compilation changes the nodes produced from the same strategy
 * and overrides (range defaults, toggle rules, validation).
 */
export const searchSpaceVersion = 2;

export interface CompiledSearchSpace {
  baseStrategy: Strategy;
  nodes: SearchSpaceNode[];
}

export interface SearchSpaceInputs extends SizingSpaceInputs {
  strategy: Strategy;
  ruleRoles?: Record<string, RuleRole>;
  parameterOverrides?: Record<string, ParameterOverride>;
  structure?: StructureSearchConfig;
}

function atLeastCountNodes(
  baseStrategy: Strategy,
  structure: StructureSearchConfig | undefined,
): NumericSearchNode[] {
  const requested = structure?.atLeast;
  if (!requested || requested.length === 0) {
    return [];
  }
  const nodes: NumericSearchNode[] = [];
  for (const { path, group } of collectAtLeastGroups(baseStrategy)) {
    const groupId = pathId(path);
    if (!requested.includes(groupId) || group.enabled === false || group.conditions.length < 2) {
      continue;
    }
    const countPath = [...path, "count"];
    nodes.push({
      id: pathId(countPath),
      kind: "numeric",
      path: countPath,
      valueType: "integer",
      min: 1,
      max: group.conditions.length,
      step: 1,
      scale: "linear",
      current: group.count ?? group.conditions.length,
    });
  }
  return nodes;
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
    if (inputs.structure?.operators?.includes(ruleId)) {
      const operatorPath = [...path, "operator"];
      const operatorNode: OperatorSearchNode = {
        id: pathId(operatorPath),
        kind: "operator",
        path: operatorPath,
        choices: [...comparisonOperators],
        current: rule.operator,
      };
      nodes.push(operatorNode);
    }
  }

  nodes.push(...atLeastCountNodes(baseStrategy, inputs.structure));
  nodes.push(...sizingSearchNodes(inputs));

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
