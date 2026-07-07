import type { IndicatorKind } from "./indicators.ts";

export type PriceField = "open" | "high" | "low" | "close" | "volume";

export type ComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "cross_above"
  | "cross_below";

export type GroupOperator = "and" | "or" | "not";

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

export type StrategyOperand = IndicatorOperand | PriceOperand | ValueOperand;

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
  /** Absent means enabled; false means the whole group is skipped during evaluation. */
  enabled?: boolean;
}

export type StrategyCondition = StrategyRule | StrategyGroup;

export interface Strategy {
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
}

export interface StrategyRecord {
  id: number;
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
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
  side: "buy" | "sell";
}
