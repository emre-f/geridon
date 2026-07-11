import { XIcon } from "lucide-react";

import type {
  ComparisonOperator,
  IndicatorDefinition,
  StrategyRule,
} from "@/lib/api";
import { comparisonOperatorOptions } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { OperandEditor } from "@/components/strategy-operand-editor";
import { VisibilityToggle } from "@/components/strategy-visibility-toggle";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

export function RuleEditor({
  rule,
  catalog,
  onChange,
  onRemove,
}: {
  rule: StrategyRule;
  catalog: IndicatorDefinition[];
  onChange: (rule: StrategyRule) => void;
  onRemove: () => void;
}) {
  const hidden = rule.enabled === false;
  const awaitingIndicator = [rule.left, rule.right].some(
    (operand) => operand.type === "indicator" && !operand.kind,
  );

  return (
    <div
      className={cn(
        "border-border bg-background flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border p-2.5",
        hidden && "border-dashed",
        awaitingIndicator && "bg-muted/20 border-dashed",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-2",
          hidden && "opacity-50",
        )}
      >
        <OperandEditor
          label="Left side"
          operand={rule.left}
          catalog={catalog}
          onChange={(left) => onChange({ ...rule, left })}
        />
        <Field label="Condition">
          <Select
            value={rule.operator}
            aria-label="Comparison operator"
            disabled={awaitingIndicator}
            title={awaitingIndicator ? "Select an indicator to configure this condition" : undefined}
            className="w-36"
            onChange={(event) =>
              onChange({ ...rule, operator: event.target.value as ComparisonOperator })
            }
          >
            {comparisonOperatorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <OperandEditor
          label="Right side"
          operand={rule.right}
          catalog={catalog}
          onChange={(right) => onChange({ ...rule, right })}
        />
      </div>
      <div className="ml-auto flex items-center">
        <VisibilityToggle
          hidden={hidden}
          subject="rule"
          onToggle={() => onChange({ ...rule, enabled: hidden })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8"
          aria-label="Remove rule"
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
