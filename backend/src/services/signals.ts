import { computeIndicatorValueSeries } from "./indicators.ts";
import { buildSignalSeries } from "./signalSeries.ts";
import type { SharedSeriesScope } from "./optimization/indicatorCache.ts";
import type { EventRecord } from "../types/events.ts";
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
  events?: readonly EventRecord[];
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

// days_since is +Infinity before the ticker's first event; only signal
// operands may compare it, so non-finite indicator values stay inert.
function comparable(operand: StrategyOperand, value: number | null | undefined): value is number {
  return (
    value != null && (Number.isFinite(value) || (value === Infinity && operand.type === "signal"))
  );
}

function operandKey(operand: StrategyOperand) {
  if (operand.type === "price") {
    return `price:${operand.field}`;
  }
  if (operand.type === "value") {
    return `value:${operand.value}`;
  }
  if (operand.type === "signal") {
    return `signal:${operand.kind}:${operand.output}:${operand.window ?? ""}:${stableParametersKey(operand.filters ?? {})}`;
  }
  return `indicator:${indicatorKey(operand)}`;
}

function buildOperandSeries(operand: StrategyOperand, context: SeriesContext): NumericSeries {
  const { candles } = context;
  if (operand.type === "price") {
    return candles.map((candle) => candle[operand.field]);
  }
  if (operand.type === "value") {
    return Array(candles.length).fill(operand.value);
  }
  if (operand.type === "signal") {
    if (context.events == null) {
      throw new Error("Signal operands need the ticker's events; this evaluation path does not provide them.");
    }
    return buildSignalSeries(operand, context.events, candles);
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
    shareable?.get(key) ?? buildOperandSeries(operand, context);
  context.cache.set(key, series);
  shareable?.set(key, series);
  return series;
}

function evaluateRule(rule: StrategyRule, context: SeriesContext, index: number) {
  const left = operandSeries(rule.left, context);
  const right = operandSeries(rule.right, context);
  const leftValue = left[index];
  const rightValue = right[index];

  if (!comparable(rule.left, leftValue) || !comparable(rule.right, rightValue)) {
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
        comparable(rule.left, previousLeft) &&
        comparable(rule.right, previousRight) &&
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
        comparable(rule.left, previousLeft) &&
        comparable(rule.right, previousRight) &&
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

/** Early-exit probe used to reject signal-starved candidates before backtesting. */
export function entrySignalFires(
  strategy: Strategy,
  candles: Candle[],
  shared?: SharedSeriesScope,
  events?: readonly EventRecord[],
): boolean {
  const entry = pruneDisabledConditions(strategy.entry);
  if (!entry) {
    return false;
  }
  const context: SeriesContext = { candles, cache: new Map(), shared, events };
  for (let index = 0; index < candles.length; index += 1) {
    if (evaluateCondition(entry, context, index)) {
      return true;
    }
  }
  return false;
}

export function evaluateSignals(
  strategy: Strategy,
  candles: Candle[],
  shared?: SharedSeriesScope,
  events?: readonly EventRecord[],
): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const context: SeriesContext = { candles, cache: new Map(), shared, events };
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
