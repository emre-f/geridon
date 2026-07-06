import type {
  ComparisonOperator,
  GroupOperator,
  IndicatorDefinition,
  PriceField,
  StrategyCondition,
  StrategyDraft,
  StrategyGroup,
  StrategyOperand,
  StrategyRule,
} from "@/lib/api";

export const comparisonOperatorOptions: Array<{ value: ComparisonOperator; label: string }> = [
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "cross_above", label: "crosses above" },
  { value: "cross_below", label: "crosses below" },
];

export const groupOperatorOptions: Array<{ value: GroupOperator; label: string }> = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
  { value: "not", label: "NOT" },
];

export const priceFieldOptions: Array<{ value: PriceField; label: string }> = [
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "close", label: "Close" },
  { value: "volume", label: "Volume" },
];

export function createNodeId() {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultIndicatorOperand(definition: IndicatorDefinition): StrategyOperand {
  return {
    type: "indicator",
    kind: definition.kind,
    parameters: Object.fromEntries(
      definition.parameters.map((parameter) => [parameter.key, parameter.default_value]),
    ),
    output: definition.values[0].key,
  };
}

export function createRuleNode(
  catalog: IndicatorDefinition[],
  operator: ComparisonOperator = "cross_above",
): StrategyRule {
  const definition = catalog[0];
  return {
    id: createNodeId(),
    type: "rule",
    left: { type: "price", field: "close" },
    operator,
    right: definition
      ? defaultIndicatorOperand(definition)
      : { type: "value", value: 0 },
  };
}

export function createGroupNode(conditions: StrategyCondition[] = []): StrategyGroup {
  return { id: createNodeId(), type: "group", operator: "and", conditions };
}

export function createStrategyDraft(catalog: IndicatorDefinition[]): StrategyDraft {
  return {
    name: "New strategy",
    entry: createGroupNode([createRuleNode(catalog, "cross_above")]),
    exit: createGroupNode([createRuleNode(catalog, "cross_below")]),
  };
}

/**
 * The builder always edits a group at the top of each tree; the backend also
 * accepts a bare rule as the root, so wrap one when loading.
 */
export function asRootGroup(condition: StrategyCondition): StrategyGroup {
  return condition.type === "group" ? condition : createGroupNode([condition]);
}

/** Turns a backend issue path like "entry.conditions[0].left" into readable text. */
export function describeIssuePath(path: string) {
  if (!path) {
    return "Strategy";
  }

  return path
    .replace(/^entry/, "Entry")
    .replace(/^exit/, "Exit")
    .replace(/^name$/, "Name")
    .replace(/\.conditions\[(\d+)\]/g, (_, index) => ` › condition ${Number(index) + 1}`)
    .replace(/\.left$/, " › left side")
    .replace(/\.right$/, " › right side");
}
