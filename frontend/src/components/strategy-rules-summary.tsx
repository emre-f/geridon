import type {
  IndicatorDefinition,
  IndicatorKind,
  SnapshotCondition,
  StrategyOperand,
  StrategySnapshot,
} from "@/lib/api";
import { signalOperandSummary } from "@/lib/signal-catalog";
import { comparisonOperatorOptions, priceFieldOptions } from "@/lib/strategy";
import { cn } from "@/lib/utils";

type DefinitionsByKind = Map<IndicatorKind, IndicatorDefinition>;

function operandLabel(operand: StrategyOperand, definitionsByKind: DefinitionsByKind): string {
  if (operand.type === "price") {
    return priceFieldOptions.find((option) => option.value === operand.field)?.label ?? operand.field;
  }
  if (operand.type === "value") {
    return String(operand.value);
  }
  if (operand.type === "signal") {
    return signalOperandSummary(operand);
  }

  const definition = definitionsByKind.get(operand.kind);
  const label = definition?.label ?? operand.kind.toUpperCase();
  const parameters = (definition?.parameters ?? [])
    .map((parameter) => operand.parameters[parameter.key])
    .filter((value) => value != null);
  const values = parameters.length > 0 ? parameters : Object.values(operand.parameters);
  const output =
    definition != null && definition.values.length > 1 ? ` ${operand.output}` : "";
  return `${label}(${values.join(", ")})${output}`;
}

function ConditionLines({
  condition,
  definitionsByKind,
}: {
  condition: SnapshotCondition;
  definitionsByKind: DefinitionsByKind;
}) {
  const disabled = condition.enabled === false;

  if (condition.type === "rule") {
    const operator =
      comparisonOperatorOptions.find((option) => option.value === condition.operator)?.label ??
      condition.operator;
    return (
      <li className={cn(disabled && "line-through opacity-50")}>
        {operandLabel(condition.left, definitionsByKind)}{" "}
        <span className="text-muted-foreground">{operator}</span>{" "}
        {operandLabel(condition.right, definitionsByKind)}
        {disabled ? <span className="text-muted-foreground no-underline"> (off)</span> : null}
      </li>
    );
  }

  const operatorLabel =
    condition.operator === "at_least"
      ? `at least ${condition.count ?? condition.conditions.length}`
      : condition.operator;

  return (
    <li className={cn(disabled && "opacity-50")}>
      <span className="text-muted-foreground font-medium uppercase">{operatorLabel}</span>
      {disabled ? <span className="text-muted-foreground"> (off)</span> : null}
      <ul className="border-border ml-1.5 flex flex-col gap-0.5 border-l pl-3">
        {condition.conditions.map((child) => (
          <ConditionLines
            key={JSON.stringify(child)}
            condition={child}
            definitionsByKind={definitionsByKind}
          />
        ))}
      </ul>
    </li>
  );
}

/**
 * Read-only view of the exact rules a backtest run evaluated, rendered from
 * the run's stored snapshot so later strategy edits never change what it says.
 */
export function StrategyRulesSummary({
  snapshot,
  definitionsByKind,
}: {
  snapshot: StrategySnapshot;
  definitionsByKind: DefinitionsByKind;
}) {
  const sides: Array<{ key: "entry" | "exit" | "cash"; label: string }> = [
    { key: "entry", label: "Entry" },
    { key: "exit", label: "Exit" },
  ];
  if (snapshot.cash) {
    sides.push({ key: "cash", label: "Cash" });
  }

  return (
    <div className={cn("grid gap-3 text-xs", snapshot.cash ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {sides.map(({ key, label }) => {
        const condition = snapshot[key];
        if (!condition) {
          return null;
        }
        return (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-muted-foreground font-medium">{label}</span>
            <ul className="flex flex-col gap-0.5">
              <ConditionLines condition={condition} definitionsByKind={definitionsByKind} />
            </ul>
          </div>
        );
      })}
    </div>
  );
}
