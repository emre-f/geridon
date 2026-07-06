import {
  indicatorCatalog,
  indicatorDefinition,
  isIndicatorKind,
  normalizeIndicatorParameters,
} from "./indicators.ts";
import type {
  ComparisonOperator,
  GroupOperator,
  PriceField,
  Strategy,
  StrategyCondition,
  StrategyOperand,
  StrategyValidationIssue,
} from "../types.ts";

export const comparisonOperators: ComparisonOperator[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "cross_above",
  "cross_below",
];

export const groupOperators: GroupOperator[] = ["and", "or", "not"];

export const priceFields: PriceField[] = ["open", "high", "low", "close", "volume"];

const crossOperators = new Set<ComparisonOperator>(["cross_above", "cross_below"]);
const maxNameLength = 80;
const maxGroupDepth = 6;
const maxRules = 32;

interface ValidationContext {
  errors: StrategyValidationIssue[];
  rules: number;
}

function issue(context: ValidationContext, path: string, message: string) {
  context.errors.push({ path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function validateOperand(
  raw: unknown,
  path: string,
  context: ValidationContext,
): StrategyOperand | null {
  if (!isRecord(raw)) {
    issue(context, path, "Operand must be an object.");
    return null;
  }

  if (raw.type === "indicator") {
    if (typeof raw.kind !== "string" || !isIndicatorKind(raw.kind)) {
      const supported = indicatorCatalog.map((definition) => definition.kind).join(", ");
      issue(context, path, `Unsupported indicator kind. Use one of: ${supported}.`);
      return null;
    }

    const definition = indicatorDefinition(raw.kind);
    const outputKeys = definition.values.map((value) => value.key);
    const output = raw.output == null ? outputKeys[0] : raw.output;
    if (typeof output !== "string" || !outputKeys.includes(output)) {
      issue(
        context,
        path,
        `Unknown ${definition.kind} output. Use one of: ${outputKeys.join(", ")}.`,
      );
      return null;
    }

    try {
      const parameters = normalizeIndicatorParameters(
        definition.kind,
        isRecord(raw.parameters) ? raw.parameters : {},
      );
      return { type: "indicator", kind: definition.kind, parameters, output };
    } catch (error) {
      issue(context, path, error instanceof Error ? error.message : "Invalid indicator parameters.");
      return null;
    }
  }

  if (raw.type === "price") {
    if (typeof raw.field !== "string" || !priceFields.includes(raw.field as PriceField)) {
      issue(context, path, `Price field must be one of: ${priceFields.join(", ")}.`);
      return null;
    }
    return { type: "price", field: raw.field as PriceField };
  }

  if (raw.type === "value") {
    const value = Number(raw.value);
    if (typeof raw.value !== "number" || !Number.isFinite(value)) {
      issue(context, path, "Value must be a finite number.");
      return null;
    }
    return { type: "value", value };
  }

  issue(context, path, 'Operand type must be "indicator", "price", or "value".');
  return null;
}

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

    const conditions = raw.conditions.map((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, depth + 1, context),
    );
    if (conditions.some((condition) => condition == null)) {
      return null;
    }

    return {
      type: "group",
      operator: raw.operator as GroupOperator,
      conditions: conditions as StrategyCondition[],
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
    if (operator == null || left == null || right == null) {
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

    return { type: "rule", left, operator, right };
  }

  issue(context, path, 'Condition type must be "rule" or "group".');
  return null;
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

  if (name == null || entry == null || exit == null || context.errors.length > 0) {
    return { strategy: null, errors: context.errors };
  }

  return { strategy: { name, entry, exit }, errors: [] };
}

export function normalizeStrategy(raw: unknown): Strategy {
  const { strategy, errors } = validateStrategy(raw);
  if (strategy == null) {
    throw new Error(errors[0]?.message ?? "Invalid strategy.");
  }
  return strategy;
}
