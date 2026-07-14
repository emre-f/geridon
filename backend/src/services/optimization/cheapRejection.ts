import { pruneDisabledConditions } from "../signals.ts";
import type {
  Strategy,
  StrategyCondition,
  StrategyGroup,
  StrategyOperand,
  StrategyRule,
} from "../../types.ts";

function operandKey(operand: StrategyOperand): string {
  if (operand.type === "price") {
    return `price:${operand.field}`;
  }
  if (operand.type === "value") {
    return `value:${operand.value}`;
  }
  const parameters = Object.entries(operand.parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${operand.kind}(${parameters}).${operand.output}`;
}

export function canonicalRuleKey(rule: StrategyRule): string {
  return `${operandKey(rule.left)} ${rule.operator} ${operandKey(rule.right)}`;
}

/** Structural certainty that a single rule can never inform a decision. */
export function ruleRejectionReason(rule: StrategyRule): string | null {
  if (operandKey(rule.left) !== operandKey(rule.right)) {
    return null;
  }
  const outcome =
    rule.operator === "gte" || rule.operator === "lte" ? "always true" : "always false";
  return `"${canonicalRuleKey(rule)}" compares an operand to itself and is ${outcome}`;
}

interface Bound {
  value: number;
  strict: boolean;
}

/**
 * Rules that must all hold at once: the group's direct rule children plus the
 * rules of nested `and` groups (their conditions must hold simultaneously too).
 */
function simultaneousRules(group: StrategyGroup): StrategyRule[] {
  const rules: StrategyRule[] = [];
  for (const child of group.conditions) {
    if (child.type === "rule") {
      rules.push(child);
    } else if (child.operator === "and") {
      rules.push(...simultaneousRules(child));
    }
  }
  return rules;
}

function contradictionReason(rules: StrategyRule[]): string | null {
  const lowerBounds = new Map<string, Bound>();
  const upperBounds = new Map<string, Bound>();
  const crossKeys = new Map<string, StrategyRule>();

  for (const rule of rules) {
    const leftKey = operandKey(rule.left);
    if (rule.operator === "cross_above" || rule.operator === "cross_below") {
      const pairKey = `${leftKey}|${operandKey(rule.right)}`;
      const opposite = crossKeys.get(pairKey);
      if (opposite && opposite.operator !== rule.operator) {
        return `"${canonicalRuleKey(opposite)}" and "${canonicalRuleKey(rule)}" can never fire on the same candle`;
      }
      crossKeys.set(pairKey, rule);
      continue;
    }
    if (rule.right.type !== "value") {
      continue;
    }
    const bound: Bound = {
      value: rule.right.value,
      strict: rule.operator === "gt" || rule.operator === "lt",
    };
    const side = rule.operator === "gt" || rule.operator === "gte" ? lowerBounds : upperBounds;
    const existing = side.get(leftKey);
    const tighter =
      side === lowerBounds
        ? !existing || bound.value > existing.value || (bound.value === existing.value && bound.strict)
        : !existing || bound.value < existing.value || (bound.value === existing.value && bound.strict);
    if (tighter) {
      side.set(leftKey, bound);
    }
  }

  for (const [key, lower] of lowerBounds) {
    const upper = upperBounds.get(key);
    if (!upper) {
      continue;
    }
    const impossible =
      upper.value < lower.value ||
      (upper.value === lower.value && (lower.strict || upper.strict));
    if (impossible) {
      return `${key} cannot be above ${lower.value} and below ${upper.value} at the same time`;
    }
  }
  return null;
}

function conditionReason(condition: StrategyCondition): string | null {
  if (condition.type === "rule") {
    return ruleRejectionReason(condition);
  }

  const seen = new Set<string>();
  for (const child of condition.conditions) {
    if (child.type !== "rule") {
      continue;
    }
    const key = canonicalRuleKey(child);
    if (seen.has(key)) {
      return `duplicate rule "${key}" in the same group`;
    }
    seen.add(key);
  }

  if (condition.operator === "and") {
    const contradiction = contradictionReason(simultaneousRules(condition));
    if (contradiction) {
      return contradiction;
    }
  }

  for (const child of condition.conditions) {
    const reason = conditionReason(child);
    if (reason) {
      return reason;
    }
  }
  return null;
}

/**
 * Structural checks that condemn a candidate without touching market data:
 * rules that are always true/false, duplicate rules in one group, and
 * threshold or cross combinations an `and` group can never satisfy. Runs on
 * the pruned tree so disabled conditions cannot cause a rejection.
 */
export function cheapRejectionReason(strategy: Strategy): string | null {
  for (const side of ["entry", "exit", "cash"] as const) {
    const condition = strategy[side];
    if (!condition) {
      continue;
    }
    const pruned = pruneDisabledConditions(condition);
    if (!pruned) {
      continue;
    }
    const reason = conditionReason(pruned);
    if (reason) {
      return `${side}: ${reason}`;
    }
  }
  return null;
}
