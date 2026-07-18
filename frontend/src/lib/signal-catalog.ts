import type { SignalEventKind, SignalOperand, SignalOutput } from "@/lib/api-strategy-types";

export interface SignalFilterField {
  key: string;
  label: string;
  /** Boolean payload flags compare as 0/1; adding one requires the flag to be true. */
  boolean?: boolean;
  step?: number;
}

export interface SignalKindDefinition {
  kind: SignalEventKind;
  label: string;
  description: string;
  filterFields: SignalFilterField[];
}

const scoreField: SignalFilterField = { key: "score", label: "Min score", step: 0.1 };

const insiderTransactionFields: SignalFilterField[] = [
  scoreField,
  { key: "dollar_value", label: "Min dollar value", step: 1000 },
  { key: "shares", label: "Min shares", step: 100 },
  { key: "price", label: "Min price", step: 1 },
  { key: "is_officer", label: "Officers only", boolean: true },
  { key: "is_director", label: "Directors only", boolean: true },
  { key: "is_ten_percent_owner", label: "10% owners only", boolean: true },
];

export const signalCatalog: SignalKindDefinition[] = [
  {
    kind: "insider_cluster_buy",
    label: "Insider Cluster Buy",
    description: "Multiple insiders buying the same ticker within a short window.",
    filterFields: [
      scoreField,
      { key: "insider_count", label: "Min insiders", step: 1 },
      { key: "combined_dollar_value", label: "Min combined dollar value", step: 10000 },
    ],
  },
  {
    kind: "insider_buy",
    label: "Insider Buy",
    description: "A single open-market insider purchase from a Form 4 filing.",
    filterFields: insiderTransactionFields,
  },
  {
    kind: "insider_sell",
    label: "Insider Sell",
    description: "A single open-market insider sale from a Form 4 filing.",
    filterFields: insiderTransactionFields,
  },
];

export const signalOutputOptions: Array<{
  value: SignalOutput;
  label: string;
  description: string;
}> = [
  {
    value: "days_since",
    label: "Days since",
    description:
      "Bars since the last matching event became available. Infinite before the first, so rules stay inert until an event exists.",
  },
  {
    value: "count_in_window",
    label: "Count in window",
    description: "Matching events that became available over the trailing window of bars.",
  },
  {
    value: "last_score",
    label: "Last score",
    description: "The most recent matching event's score, carried forward bar by bar.",
  },
];

export function signalKindDefinition(kind: string): SignalKindDefinition | undefined {
  return signalCatalog.find((definition) => definition.kind === kind);
}

export function signalKindLabel(kind: string): string {
  return (
    signalKindDefinition(kind)?.label ??
    kind
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export function defaultSignalOperand(): SignalOperand {
  return { type: "signal", kind: signalCatalog[0].kind, output: "days_since" };
}

export function signalOperandSummary(operand: SignalOperand): string {
  const label = signalKindLabel(operand.kind);
  const core =
    operand.output === "count_in_window"
      ? `${label} count (${operand.window ?? 1} bars)`
      : operand.output === "last_score"
        ? `${label} last score`
        : `Days since ${label}`;
  const filterCount = operand.filters ? Object.keys(operand.filters).length : 0;
  if (filterCount === 0) {
    return core;
  }
  return `${core} (${filterCount} filter${filterCount === 1 ? "" : "s"})`;
}
