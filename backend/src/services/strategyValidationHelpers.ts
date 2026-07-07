import type {
  ComparisonOperator,
  GroupOperator,
  PriceField,
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

export const crossOperators = new Set<ComparisonOperator>(["cross_above", "cross_below"]);
export const maxNameLength = 80;
export const maxGroupDepth = 6;
export const maxRules = 32;

export interface ValidationContext {
  errors: StrategyValidationIssue[];
  rules: number;
}

export function issue(context: ValidationContext, path: string, message: string) {
  context.errors.push({ path, message });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
