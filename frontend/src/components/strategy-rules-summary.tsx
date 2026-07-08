import { ChevronRightIcon } from "lucide-react";

import type {
  IndicatorDefinition,
  IndicatorKind,
  SnapshotCondition,
  StrategyOperand,
  StrategySnapshot,
} from "@/lib/api";
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

  return (
    <li className={cn(disabled && "opacity-50")}>
      <span className="text-muted-foreground font-medium uppercase">{condition.operator}</span>
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
  return (
    <details className="group text-xs">
      <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer select-none items-center gap-1 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
        Rules used in this run
      </summary>
      <div className="mt-2 grid gap-3 pl-4.5 sm:grid-cols-2">
        {(["entry", "exit"] as const).map((side) => (
          <div key={side} className="flex flex-col gap-1">
            <span className="text-muted-foreground font-medium">
              {side === "entry" ? "Entry" : "Exit"}
            </span>
            <ul className="flex flex-col gap-0.5">
              <ConditionLines condition={snapshot[side]} definitionsByKind={definitionsByKind} />
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
