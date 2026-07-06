import { computeIndicatorValueSeries } from "./indicators.ts";
import type {
  Candle,
  PriceField,
  Strategy,
  StrategyCondition,
  StrategyOperand,
  StrategyRule,
  StrategySignal,
} from "../types.ts";

type NumericSeries = Array<number | null>;

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

function priceSeries(candles: Candle[], field: PriceField): NumericSeries {
  return candles.map((candle) => candle[field]);
}

function valueSeries(candles: Candle[], value: number): NumericSeries {
  return Array(candles.length).fill(value);
}

function operandSeries(
  operand: StrategyOperand,
  candles: Candle[],
  cache: Map<string, NumericSeries>,
): NumericSeries {
  if (operand.type === "price") {
    return priceSeries(candles, operand.field);
  }
  if (operand.type === "value") {
    return valueSeries(candles, operand.value);
  }

  const key = indicatorKey(operand);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const series = computeIndicatorValueSeries(
    candles,
    operand.kind,
    operand.parameters,
    operand.output,
  );
  cache.set(key, series);
  return series;
}

function evaluateRule(
  rule: StrategyRule,
  candles: Candle[],
  index: number,
  cache: Map<string, NumericSeries>,
) {
  const left = operandSeries(rule.left, candles, cache);
  const right = operandSeries(rule.right, candles, cache);
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
  candles: Candle[],
  index: number,
  cache: Map<string, NumericSeries>,
): boolean {
  if (condition.type === "rule") {
    return evaluateRule(condition, candles, index, cache);
  }

  if (condition.operator === "and") {
    return condition.conditions.every((child) => evaluateCondition(child, candles, index, cache));
  }
  if (condition.operator === "or") {
    return condition.conditions.some((child) => evaluateCondition(child, candles, index, cache));
  }

  return !evaluateCondition(condition.conditions[0], candles, index, cache);
}

export function evaluateSignals(strategy: Strategy, candles: Candle[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const cache = new Map<string, NumericSeries>();

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    if (evaluateCondition(strategy.entry, candles, index, cache)) {
      signals.push({ timestamp_ms: candle.timestamp_ms, side: "buy" });
    }
    if (evaluateCondition(strategy.exit, candles, index, cache)) {
      signals.push({ timestamp_ms: candle.timestamp_ms, side: "sell" });
    }
  }

  return signals;
}
