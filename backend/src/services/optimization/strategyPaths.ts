import { pruneDisabledConditions } from "../signals.ts";
import type {
  IndicatorOperand,
  Strategy,
  StrategyComplexity,
  StrategyCondition,
  StrategyOperand,
  StrategyRule,
} from "../../types.ts";

export type StrategySide = "entry" | "exit" | "cash";

export const strategySides: StrategySide[] = ["entry", "exit", "cash"];

export function cloneStrategy(strategy: Strategy): Strategy {
  return structuredClone(strategy);
}

export function pathId(path: string[]): string {
  return path.join(".");
}

export function getAtPath(strategy: Strategy, path: string[]): unknown {
  let node: unknown = strategy;
  for (const segment of path) {
    if (node == null || typeof node !== "object") {
      return undefined;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

export function setAtPath(strategy: Strategy, path: string[], value: unknown): void {
  let node: unknown = strategy;
  for (const segment of path.slice(0, -1)) {
    node = (node as Record<string, unknown>)[segment];
    if (node == null || typeof node !== "object") {
      throw new Error(`Invalid strategy path: ${pathId(path)}`);
    }
  }
  (node as Record<string, unknown>)[path.at(-1)!] = value;
}

function describeOperand(operand: StrategyOperand): string {
  if (operand.type === "price") {
    return operand.field;
  }
  if (operand.type === "value") {
    return String(operand.value);
  }
  const parameters = Object.values(operand.parameters).join(",");
  return `${operand.kind}(${parameters}).${operand.output}`;
}

export function describeRule(rule: StrategyRule): string {
  return `${describeOperand(rule.left)} ${rule.operator} ${describeOperand(rule.right)}`;
}

export interface LocatedRule {
  path: string[];
  rule: StrategyRule;
}

export function collectRules(strategy: Strategy): LocatedRule[] {
  const located: LocatedRule[] = [];
  const visit = (condition: StrategyCondition, path: string[]) => {
    if (condition.type === "rule") {
      located.push({ path, rule: condition });
      return;
    }
    condition.conditions.forEach((child, index) =>
      visit(child, [...path, "conditions", String(index)]),
    );
  };
  for (const side of strategySides) {
    const condition = strategy[side];
    if (condition) {
      visit(condition, [side]);
    }
  }
  return located;
}

function indicatorConfigKey(operand: IndicatorOperand): string {
  const parameters = Object.entries(operand.parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${operand.kind}(${parameters})`;
}

function activeIndicatorOperands(condition: StrategyCondition): IndicatorOperand[] {
  const operands: IndicatorOperand[] = [];
  const visitOperand = (operand: StrategyOperand) => {
    if (operand.type === "indicator") {
      operands.push(operand);
    }
  };
  const visit = (node: StrategyCondition) => {
    if (node.type === "rule") {
      visitOperand(node.left);
      visitOperand(node.right);
      return;
    }
    node.conditions.forEach(visit);
  };
  visit(condition);
  return operands;
}

export function conditionDepth(condition: StrategyCondition): number {
  if (condition.type === "rule") {
    return 1;
  }
  return 1 + Math.max(0, ...condition.conditions.map(conditionDepth));
}

export function computeComplexity(strategy: Strategy): StrategyComplexity {
  let activeRules = 0;
  let maxDepth = 0;
  const indicatorKeys = new Set<string>();
  for (const side of strategySides) {
    const condition = strategy[side];
    if (!condition) {
      continue;
    }
    const pruned = pruneDisabledConditions(condition);
    if (!pruned) {
      continue;
    }
    activeRules += collectActiveRuleCount(pruned);
    maxDepth = Math.max(maxDepth, conditionDepth(pruned));
    for (const operand of activeIndicatorOperands(pruned)) {
      indicatorKeys.add(indicatorConfigKey(operand));
    }
  }
  return { activeRules, uniqueIndicators: indicatorKeys.size, maxDepth };
}

function collectActiveRuleCount(condition: StrategyCondition): number {
  if (condition.type === "rule") {
    return 1;
  }
  return condition.conditions.reduce((sum, child) => sum + collectActiveRuleCount(child), 0);
}

export function hasActiveRule(condition: StrategyCondition | undefined): boolean {
  if (!condition) {
    return false;
  }
  return pruneDisabledConditions(condition) != null;
}
