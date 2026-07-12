import type {
  SnapshotCondition,
  StrategyValidationIssue,
  StrategyValidationResult,
} from "@/lib/api";

type StrategyTrees = {
  entry: SnapshotCondition;
  exit: SnapshotCondition;
  cash?: SnapshotCondition;
};

function collectPendingIndicators(
  condition: SnapshotCondition,
  path: string,
  errors: StrategyValidationIssue[],
) {
  if (condition.type === "group") {
    condition.conditions.forEach((child, index) =>
      collectPendingIndicators(child, `${path}.conditions[${index}]`, errors),
    );
    return;
  }

  for (const side of ["left", "right"] as const) {
    const operand = condition[side];
    if (operand.type === "indicator" && !operand.kind.trim()) {
      errors.push({ path: `${path}.${side}`, message: "Select an indicator." });
    }
  }
}

/** Returns a local validation result while an indicator picker is unresolved. */
export function pendingIndicatorValidation(
  strategy: StrategyTrees,
): StrategyValidationResult | null {
  const errors: StrategyValidationIssue[] = [];
  collectPendingIndicators(strategy.entry, "entry", errors);
  collectPendingIndicators(strategy.exit, "exit", errors);
  if (strategy.cash) {
    collectPendingIndicators(strategy.cash, "cash", errors);
  }

  return errors.length > 0 ? { valid: false, errors } : null;
}
