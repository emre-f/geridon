import { validateEnabled, validateOperand } from "./strategyOperandValidation.ts";
import {
  comparisonOperators,
  crossOperators,
  groupOperators,
  isRecord,
  issue,
  maxGroupDepth,
  maxNameLength,
  maxRules,
  type ValidationContext,
} from "./strategyValidationHelpers.ts";
import type {
  ComparisonOperator,
  GroupOperator,
  Strategy,
  StrategyCondition,
  StrategyValidationIssue,
} from "../types.ts";

export { comparisonOperators, groupOperators, priceFields } from "./strategyValidationHelpers.ts";

function validateCondition(
  raw: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
): StrategyCondition | null {
  if (!isRecord(raw)) {
    issue(context, path, "Condition must be an object.");
    return null;
  }

  if (raw.type === "group") {
    if (depth > maxGroupDepth) {
      issue(context, path, `Groups can be nested at most ${maxGroupDepth} levels deep.`);
      return null;
    }

    if (typeof raw.operator !== "string" || !groupOperators.includes(raw.operator as GroupOperator)) {
      issue(context, path, `Group operator must be one of: ${groupOperators.join(", ")}.`);
      return null;
    }

    if (!Array.isArray(raw.conditions)) {
      issue(context, path, "Group conditions must be an array.");
      return null;
    }
    if (raw.conditions.length === 0) {
      issue(context, path, "Group must contain at least one condition.");
      return null;
    }
    if (raw.operator === "not" && raw.conditions.length !== 1) {
      issue(context, path, "NOT groups must contain exactly one condition.");
      return null;
    }

    let count: number | undefined;
    if (raw.operator === "at_least") {
      const rawCount = Number(raw.count);
      // Disabled conditions are pruned before evaluation, so a count above the
      // enabled total could never be satisfied.
      const enabledTotal = raw.conditions.filter(
        (condition) => !isRecord(condition) || condition.enabled !== false,
      ).length;
      const limit = enabledTotal > 0 ? enabledTotal : raw.conditions.length;
      if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > limit) {
        const qualifier = limit < raw.conditions.length ? " (disabled conditions don't count)" : "";
        issue(
          context,
          path,
          `"at least" count must be a whole number between 1 and ${limit}${qualifier}.`,
        );
        return null;
      }
      count = rawCount;
    }

    const conditions = raw.conditions.map((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, depth + 1, context),
    );
    const enabled = validateEnabled(raw, path, context);
    if (conditions.some((condition) => condition == null) || enabled == null) {
      return null;
    }

    return {
      type: "group",
      operator: raw.operator as GroupOperator,
      conditions: conditions as StrategyCondition[],
      ...(count == null ? {} : { count }),
      ...enabled,
    };
  }

  if (raw.type === "rule") {
    context.rules += 1;
    if (context.rules > maxRules) {
      issue(context, path, `Strategies support up to ${maxRules} rules.`);
      return null;
    }

    let operator: ComparisonOperator | null = null;
    if (
      typeof raw.operator !== "string" ||
      !comparisonOperators.includes(raw.operator as ComparisonOperator)
    ) {
      issue(context, path, `Unsupported operator. Use one of: ${comparisonOperators.join(", ")}.`);
    } else {
      operator = raw.operator as ComparisonOperator;
    }

    const left = validateOperand(raw.left, `${path}.left`, context);
    const right = validateOperand(raw.right, `${path}.right`, context);
    const enabled = validateEnabled(raw, path, context);
    if (operator == null || left == null || right == null || enabled == null) {
      return null;
    }

    if (left.type === "value" && right.type === "value") {
      issue(context, path, "A rule cannot compare two fixed values.");
      return null;
    }
    if (crossOperators.has(operator) && left.type === "value") {
      issue(
        context,
        `${path}.left`,
        "Cross conditions need an indicator or price series on the left side.",
      );
      return null;
    }

    return { type: "rule", left, operator, right, ...enabled };
  }

  issue(context, path, 'Condition type must be "rule" or "group".');
  return null;
}

/** Validates one standalone rule, e.g. an entry in an evolution rule library. */
export function validateRule(
  raw: unknown,
  path: string,
): { rule: StrategyCondition | null; errors: StrategyValidationIssue[] } {
  const context: ValidationContext = { errors: [], rules: 0 };
  const condition = validateCondition(raw, path, 1, context);
  if (condition != null && condition.type !== "rule") {
    issue(context, path, "Must be a single rule, not a group.");
    return { rule: null, errors: context.errors };
  }
  return { rule: condition, errors: context.errors };
}

export function validateStrategy(raw: unknown): {
  strategy: Strategy | null;
  errors: StrategyValidationIssue[];
} {
  const context: ValidationContext = { errors: [], rules: 0 };

  if (!isRecord(raw)) {
    issue(context, "", "Strategy must be a JSON object.");
    return { strategy: null, errors: context.errors };
  }

  let name: string | null = null;
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    issue(context, "name", "Strategy name is required.");
  } else if (raw.name.trim().length > maxNameLength) {
    issue(context, "name", `Strategy name must be ${maxNameLength} characters or fewer.`);
  } else {
    name = raw.name.trim();
  }

  const entry = raw.entry == null
    ? (issue(context, "entry", "Entry condition is required."), null)
    : validateCondition(raw.entry, "entry", 1, context);
  const exit = raw.exit == null
    ? (issue(context, "exit", "Exit condition is required."), null)
    : validateCondition(raw.exit, "exit", 1, context);
  const cash = raw.cash == null ? undefined : validateCondition(raw.cash, "cash", 1, context);
  const cashInvalid = raw.cash != null && cash == null;

  if (name == null || entry == null || exit == null || cashInvalid || context.errors.length > 0) {
    return { strategy: null, errors: context.errors };
  }

  return { strategy: { name, entry, exit, ...(cash ? { cash } : {}) }, errors: [] };
}

export function normalizeStrategy(raw: unknown): Strategy {
  const { strategy, errors } = validateStrategy(raw);
  if (strategy == null) {
    throw new Error(errors[0]?.message ?? "Invalid strategy.");
  }
  return strategy;
}
