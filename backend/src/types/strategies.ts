import type { EventKind } from "./events.ts";
import type { IndicatorKind } from "./indicators.ts";

export type PriceField = "open" | "high" | "low" | "close" | "volume";

export type ComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "cross_above"
  | "cross_below";

export type GroupOperator = "and" | "or" | "not" | "at_least";

export interface IndicatorOperand {
  type: "indicator";
  kind: IndicatorKind;
  parameters: Record<string, number>;
  output: string;
}

export interface PriceOperand {
  type: "price";
  field: PriceField;
}

export interface ValueOperand {
  type: "value";
  value: number;
}

export type SignalOutput = "days_since" | "count_in_window" | "last_score";

/**
 * Events as an ordinary per-bar numeric series, so every comparison operator
 * works unchanged: days_since counts bars since the last matching event
 * (+Infinity before the first), count_in_window counts matching events over
 * the trailing window, last_score carries the latest event's score forward.
 */
export interface SignalOperand {
  type: "signal";
  kind: EventKind;
  filters?: Record<string, number>;
  output: SignalOutput;
  /** Bars; required by and only valid for count_in_window. */
  window?: number;
}

export type StrategyOperand = IndicatorOperand | PriceOperand | ValueOperand | SignalOperand;

export interface StrategyRule {
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
  /** Absent means enabled; false means the rule is skipped during evaluation. */
  enabled?: boolean;
}

export interface StrategyGroup {
  type: "group";
  operator: GroupOperator;
  conditions: StrategyCondition[];
  /** Required for the "at_least" operator: how many conditions must hold. */
  count?: number;
  /** Absent means enabled; false means the whole group is skipped during evaluation. */
  enabled?: boolean;
}

export type StrategyCondition = StrategyRule | StrategyGroup;

export interface Strategy {
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
  /** Go-to-cash tree used only by the three_state position mode (long/short/cash). */
  cash?: StrategyCondition;
}

export interface StrategyRecord {
  id: number;
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
  cash?: StrategyCondition;
  created_at: string;
  updated_at: string;
}

export interface StrategyValidationIssue {
  path: string;
  message: string;
}

export interface StrategyValidationResponse {
  valid: boolean;
  errors: StrategyValidationIssue[];
  strategy: Strategy | null;
}

export interface StrategySignal {
  timestamp_ms: number;
  side: "buy" | "sell" | "cash";
}
