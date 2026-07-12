import { computeIndicatorValueSeries } from "./indicators.ts";
import type { SharedSeriesScope } from "./optimization/indicatorCache.ts";
import type {
  Candle,
  Strategy,
  StrategyCondition,
  StrategyOperand,
  StrategyRule,
  StrategySignal,
} from "../types.ts";

type NumericSeries = Array<number | null>;

interface SeriesContext {
  candles: Candle[];
  cache: Map<string, NumericSeries>;
  shared?: SharedSeriesScope;
}

function stableParametersKey(parameters: Record<string, number>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function indicatorKey(operand: Extract<StrategyOperand, { type: "indicator" }>) {
  return `${operand.kind}:${stableParametersKey(operand.parameters)}:${operand.output}`;
}

function hasValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function operandKey(operand: StrategyOperand) {
  if (operand.type === "price") {
    return `price:${operand.field}`;
  }
  if (operand.type === "value") {
    return `value:${operand.value}`;
  }
  return `indicator:${indicatorKey(operand)}`;
}

function buildOperandSeries(operand: StrategyOperand, candles: Candle[]): NumericSeries {
  if (operand.type === "price") {
    return candles.map((candle) => candle[operand.field]);
  }
  if (operand.type === "value") {
    return Array(candles.length).fill(operand.value);
  }
  return computeIndicatorValueSeries(candles, operand.kind, operand.parameters, operand.output);
}

function operandSeries(operand: StrategyOperand, context: SeriesContext): NumericSeries {
  const key = operandKey(operand);
  const cached = context.cache.get(key);
  if (cached) {
    return cached;
  }

  // Indicator series are the expensive part; the shared scope reuses them
  // across candidates that evaluate the same candle slice.
  const shareable = operand.type === "indicator" ? context.shared : undefined;
  const series =
    shareable?.get(key) ?? buildOperandSeries(operand, context.candles);
  context.cache.set(key, series);
  shareable?.set(key, series);
  return series;
}

function evaluateRule(rule: StrategyRule, context: SeriesContext, index: number) {
  const left = operandSeries(rule.left, context);
  const right = operandSeries(rule.right, context);
  const leftValue = left[index];
  const rightValue = right[index];

  if (!hasValue(leftValue) || !hasValue(rightValue)) {
    return false;
  }

  switch (rule.operator) {
    case "gt":
      return leftValue > rightValue;
    case "gte":
      return leftValue >= rightValue;
    case "lt":
      return leftValue < rightValue;
    case "lte":
      return leftValue <= rightValue;
    case "cross_above": {
      if (index === 0) {
        return false;
      }
      const previousLeft = left[index - 1];
      const previousRight = right[index - 1];
      return (
        hasValue(previousLeft) &&
        hasValue(previousRight) &&
        previousLeft <= previousRight &&
        leftValue > rightValue
      );
    }
    case "cross_below": {
      if (index === 0) {
        return false;
      }
      const previousLeft = left[index - 1];
      const previousRight = right[index - 1];
      return (
        hasValue(previousLeft) &&
        hasValue(previousRight) &&
        previousLeft >= previousRight &&
        leftValue < rightValue
      );
    }
  }
}

function evaluateCondition(
  condition: StrategyCondition,
  context: SeriesContext,
  index: number,
): boolean {
  if (condition.type === "rule") {
    return evaluateRule(condition, context, index);
  }

  if (condition.operator === "and") {
    return condition.conditions.every((child) => evaluateCondition(child, context, index));
  }
  if (condition.operator === "or") {
    return condition.conditions.some((child) => evaluateCondition(child, context, index));
  }
  if (condition.operator === "at_least") {
    const required = condition.count ?? condition.conditions.length;
    let hits = 0;
    for (const child of condition.conditions) {
      if (evaluateCondition(child, context, index) && (hits += 1) >= required) {
        return true;
      }
    }
    return false;
  }

  return !evaluateCondition(condition.conditions[0], context, index);
}

/**
 * Drops conditions with `enabled: false` so they evaluate exactly as if they
 * were deleted. Groups left with no active conditions (including NOT groups
 * whose only child is disabled) are dropped too.
 */
export function pruneDisabledConditions(condition: StrategyCondition): StrategyCondition | null {
  if (condition.enabled === false) {
    return null;
  }
  if (condition.type === "rule") {
    return condition;
  }

  const conditions = condition.conditions
    .map(pruneDisabledConditions)
    .filter((child): child is StrategyCondition => child != null);
  if (conditions.length === 0) {
    return null;
  }

  // Clamp so disabling children of an "at least N" group behaves like
  // deleting them instead of leaving the group unsatisfiable.
  if (condition.operator === "at_least" && condition.count != null) {
    return { ...condition, conditions, count: Math.min(condition.count, conditions.length) };
  }
  return { ...condition, conditions };
}

export function evaluateSignals(
  strategy: Strategy,
  candles: Candle[],
  shared?: SharedSeriesScope,
): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const context: SeriesContext = { candles, cache: new Map(), shared };
  // A side with every condition disabled simply never fires.
  const entry = pruneDisabledConditions(strategy.entry);
  const exit = pruneDisabledConditions(strategy.exit);
  const cash = strategy.cash ? pruneDisabledConditions(strategy.cash) : null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    if (entry && evaluateCondition(entry, context, index)) {
      signals.push({ timestamp_ms: candle.timestamp_ms, side: "buy" });
    }
    if (exit && evaluateCondition(exit, context, index)) {
      signals.push({ timestamp_ms: candle.timestamp_ms, side: "sell" });
    }
    if (cash && evaluateCondition(cash, context, index)) {
      signals.push({ timestamp_ms: candle.timestamp_ms, side: "cash" });
    }
  }

  return signals;
}
