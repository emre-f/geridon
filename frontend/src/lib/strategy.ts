import type {
  ComparisonOperator,
  GroupOperator,
  IndicatorDefinition,
  IndicatorKind,
  IndicatorSpec,
  PriceField,
  SnapshotCondition,
  StrategyCondition,
  StrategyDraft,
  StrategyGroup,
  StrategyOperand,
  StrategyRule,
} from "@/lib/api";
import { defaultLineStyle, definitionValueSlots } from "@/lib/indicator-style";

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
  { value: "at_least", label: "N OF" },
];

export const priceFieldOptions: Array<{ value: PriceField; label: string }> = [
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "close", label: "Close" },
  { value: "volume", label: "Volume" },
];

function createNodeId() {
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

export function createCashGroup(catalog: IndicatorDefinition[]): StrategyGroup {
  return createGroupNode([createRuleNode(catalog, "lt")]);
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

function parametersKey(parameters: Record<string, number>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function strategyIndicatorKey(operand: Extract<StrategyOperand, { type: "indicator" }>) {
  return `${operand.kind}:${parametersKey(operand.parameters)}`;
}

function collectIndicatorOperands(
  condition: SnapshotCondition,
  operands: StrategyOperand[] = [],
) {
  // Disabled conditions are skipped during evaluation, so keep their
  // indicators off the chart too.
  if (condition.enabled === false) {
    return operands;
  }

  if (condition.type === "group") {
    for (const child of condition.conditions) {
      collectIndicatorOperands(child, operands);
    }
    return operands;
  }

  if (condition.left.type === "indicator") {
    operands.push(condition.left);
  }
  if (condition.right.type === "indicator") {
    operands.push(condition.right);
  }
  return operands;
}

/**
 * Deduplicated indicator specs for every indicator a strategy references, so
 * the chart can plot exactly what the rules read. Accepts drafts and stored
 * snapshots alike.
 */
export function strategyIndicatorSpecs(
  strategy:
    | { entry: SnapshotCondition; exit: SnapshotCondition; cash?: SnapshotCondition }
    | null,
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>,
): IndicatorSpec[] {
  if (!strategy) {
    return [];
  }

  const seen = new Set<string>();
  const operands = [
    ...collectIndicatorOperands(strategy.entry),
    ...collectIndicatorOperands(strategy.exit),
    ...(strategy.cash ? collectIndicatorOperands(strategy.cash) : []),
  ].filter((operand): operand is Extract<StrategyOperand, { type: "indicator" }> => operand.type === "indicator");

  return operands.flatMap((operand, index) => {
    const key = strategyIndicatorKey(operand);
    const definition = definitionsByKind.get(operand.kind);
    if (seen.has(key) || !definition) {
      return [];
    }
    seen.add(key);

    return [
      {
        id: `strategy-${operand.kind}-${index}-${key}`,
        kind: operand.kind,
        parameters: operand.parameters,
        styles: definitionValueSlots(definition).map((_, slotIndex) =>
          defaultLineStyle(seen.size - 1 + slotIndex),
        ),
      },
    ];
  });
}

/** Turns a backend issue path like "entry.conditions[0].left" into readable text. */
export function describeIssuePath(path: string) {
  if (!path) {
    return "Strategy";
  }

  return path
    .replace(/^entry/, "Entry")
    .replace(/^exit/, "Exit")
    .replace(/^cash/, "Cash")
    .replace(/^name$/, "Name")
    .replace(/\.conditions\[(\d+)\]/g, (_, index) => ` › condition ${Number(index) + 1}`)
    .replace(/\.left$/, " › left side")
    .replace(/\.right$/, " › right side");
}
