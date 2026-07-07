import type { IndicatorKind } from "@/lib/api-indicator-types";

export type ComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "cross_above"
  | "cross_below";

export type GroupOperator = "and" | "or" | "not";

export type PriceField = "open" | "high" | "low" | "close" | "volume";

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
  /** Client-side key for editing; the backend ignores and never returns it. */
  id: string;
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
  /** Absent means enabled; false means the rule is skipped during evaluation. */
  enabled?: boolean;
}

export interface StrategyGroup {
  id: string;
  type: "group";
  operator: GroupOperator;
  conditions: StrategyCondition[];
  /** Absent means enabled; false means the whole group is skipped during evaluation. */
  enabled?: boolean;
}

export type StrategyCondition = StrategyRule | StrategyGroup;

export interface StrategyDraft {
  name: string;
  entry: StrategyCondition;
  exit: StrategyCondition;
}

export interface StrategyRecord extends StrategyDraft {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface StrategyValidationIssue {
  path: string;
  message: string;
}

export interface StrategyValidationResult {
  valid: boolean;
  errors: StrategyValidationIssue[];
}

export interface StrategySignal {
  timestamp_ms: number;
  side: "buy" | "sell";
}

// Stored strategy snapshots come back without the client-side node ids that
// live StrategyCondition trees carry.
export interface SnapshotRule {
  type: "rule";
  left: StrategyOperand;
  operator: ComparisonOperator;
  right: StrategyOperand;
  enabled?: boolean;
}

export interface SnapshotGroup {
  type: "group";
  operator: GroupOperator;
  conditions: SnapshotCondition[];
  enabled?: boolean;
}

export type SnapshotCondition = SnapshotRule | SnapshotGroup;

export interface StrategySnapshot {
  name: string;
  entry: SnapshotCondition;
  exit: SnapshotCondition;
}
