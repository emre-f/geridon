import type {
  SignalOperand,
  Strategy,
  StrategyCondition,
  StrategyRule,
} from "../../types.ts";
import type { EventSelectionOptions } from "./eventSelection.ts";
import type { SignalEvaluationRow } from "./registry.ts";

export const promotionEntryMaxDaysSince = 1;
export const trendFilterSmaPeriod = 200;

export interface PromotionOptions {
  name?: string;
  trendFilter?: boolean;
}

type BuiltStrategy = { strategy: Strategy } | { error: string };

/**
 * Turns a candidate evaluation into a starter strategy: the validated event as
 * the entry trigger (actionable the bar after availability, matching the
 * evaluation's timing convention), a time-based exit at the natural holding
 * period the event study measured, and optionally a long-term trend filter.
 * Events are triggers, indicators are confirmation.
 */
export function buildStarterStrategy(
  evaluation: SignalEvaluationRow,
  options: PromotionOptions = {},
): BuiltStrategy {
  const holdingPeriodBars = naturalHoldingPeriodBars(evaluation);
  if (holdingPeriodBars == null) {
    return {
      error:
        `Evaluation ${evaluation.id} has no natural holding period to exit at; ` +
        "re-run the evaluation before promoting.",
    };
  }

  const trigger: StrategyRule = {
    type: "rule",
    left: signalOperand(evaluation),
    operator: "lte",
    right: { type: "value", value: promotionEntryMaxDaysSince },
  };
  const entry: StrategyCondition = options.trendFilter
    ? { type: "group", operator: "and", conditions: [trigger, trendFilterRule()] }
    : trigger;
  const exit: StrategyRule = {
    type: "rule",
    left: signalOperand(evaluation),
    operator: "gte",
    right: { type: "value", value: holdingPeriodBars },
  };

  return { strategy: { name: options.name ?? defaultName(evaluation), entry, exit } };
}

export function naturalHoldingPeriodBars(evaluation: SignalEvaluationRow): number | null {
  const summary = childRecord(evaluation.detail, "horizon_summary");
  const bars = summary?.natural_holding_period_bars;
  return typeof bars === "number" && Number.isInteger(bars) && bars >= 1 ? bars : null;
}

function signalOperand(evaluation: SignalEvaluationRow): SignalOperand {
  const filters = operandFilters(evaluation.query);
  return {
    type: "signal",
    kind: evaluation.event_kind,
    output: "days_since",
    ...(filters ? { filters } : {}),
  };
}

/**
 * The promoted operand must match exactly the events the evaluation scored:
 * payload filters carry over as-is, and the score threshold maps to the
 * reserved `score` filter key the series builder reads.
 */
function operandFilters(query: EventSelectionOptions): Record<string, number> | undefined {
  const filters = {
    ...query.payloadFilters,
    ...(query.minScore != null ? { score: query.minScore } : {}),
  };
  return Object.keys(filters).length > 0 ? filters : undefined;
}

function trendFilterRule(): StrategyRule {
  return {
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "gt",
    right: {
      type: "indicator",
      kind: "sma",
      parameters: { period: trendFilterSmaPeriod },
      output: "sma",
    },
  };
}

function defaultName(evaluation: SignalEvaluationRow): string {
  const kindLabel = evaluation.event_kind
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return `${kindLabel} starter (eval ${evaluation.id})`;
}

function childRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const child = (value as Record<string, unknown>)[key];
  if (child == null || typeof child !== "object" || Array.isArray(child)) {
    return null;
  }
  return child as Record<string, unknown>;
}
