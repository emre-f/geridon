import { PlusIcon, XIcon } from "lucide-react";

import type {
  GroupOperator,
  IndicatorDefinition,
  StrategyGroup,
  StrategyRule,
} from "@/lib/api";
import {
  createGroupNode,
  createRuleNode,
  groupOperatorOptions,
} from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { RuleEditor } from "@/components/strategy-rule-editor";
import { VisibilityToggle } from "@/components/strategy-visibility-toggle";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { SlashTabs } from "@/components/ui/slash-tabs";

const groupOperatorHints: Record<GroupOperator, string> = {
  and: "every condition must be true",
  or: "any condition may be true",
  not: "the condition must be false",
  at_least: "at least N conditions must be true",
};

function countActive(conditions: Array<StrategyGroup | StrategyRule>) {
  return conditions.filter((condition) => condition.enabled !== false).length;
}

export function ConditionGroupEditor({
  group,
  catalog,
  depth,
  onChange,
  onRemove,
}: {
  group: StrategyGroup;
  catalog: IndicatorDefinition[];
  depth: number;
  onChange: (group: StrategyGroup) => void;
  onRemove?: () => void;
}) {
  // NOT wraps a single condition, so block adding once it has one.
  const canAdd = group.operator !== "not" || group.conditions.length < 1;
  const hidden = group.enabled === false;
  const activeConditions = countActive(group.conditions);

  // Disabled conditions are pruned at evaluation, so "at least N" is always
  // clamped to the active children — disabling behaves like deleting.
  function atLeastCount(conditions: Array<StrategyGroup | StrategyRule>, fallback: number) {
    return Math.max(1, Math.min(group.count ?? fallback, Math.max(1, countActive(conditions))));
  }

  function replaceAt(index: number, condition: StrategyGroup | StrategyRule) {
    const conditions = group.conditions.map((current, currentIndex) =>
      currentIndex === index ? condition : current,
    );
    const count = group.operator === "at_least" ? atLeastCount(conditions, 1) : group.count;
    onChange({ ...group, conditions, count });
  }

  function removeAt(index: number) {
    const conditions = group.conditions.filter((_, currentIndex) => currentIndex !== index);
    const count = group.operator === "at_least" ? atLeastCount(conditions, 1) : group.count;
    onChange({ ...group, conditions, count });
  }

  function changeOperator(value: GroupOperator) {
    if (value === "at_least") {
      onChange({ ...group, operator: value, count: atLeastCount(group.conditions, 2) });
      return;
    }
    const { count: _dropped, ...rest } = group;
    onChange({ ...rest, operator: value });
  }

  function append(condition: StrategyGroup | StrategyRule) {
    onChange({ ...group, conditions: [...group.conditions, condition] });
  }

  return (
    <div
      className={cn(
        "border-border flex flex-col gap-2 rounded-md border p-2.5",
        depth > 0 && "bg-muted/40",
        hidden && "border-dashed",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("flex flex-wrap items-center gap-2", hidden && "opacity-50")}>
          <SlashTabs
            options={groupOperatorOptions}
            value={group.operator}
            aria-label="Group operator"
            onValueChange={(value) => changeOperator(value as GroupOperator)}
          />
          {group.operator === "at_least" ? (
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <NumberInput
                className="h-8 w-14"
                aria-label="Minimum conditions that must be true"
                value={group.count ?? 1}
                min={1}
                max={Math.max(1, activeConditions)}
                step={1}
                onValueChange={(value) => onChange({ ...group, count: value })}
              />
              <span>
                of {activeConditions}
                {activeConditions === group.conditions.length ? "" : " enabled"} must be true
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {groupOperatorHints[group.operator]}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            onClick={() => append(createRuleNode(catalog))}
          >
            <PlusIcon />
            Rule
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            onClick={() => append(createGroupNode([createRuleNode(catalog)]))}
          >
            <PlusIcon />
            Group
          </Button>
          {onRemove ? (
            <>
              <VisibilityToggle
                hidden={hidden}
                subject="group"
                onToggle={() => onChange({ ...group, enabled: hidden })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                aria-label="Remove group"
                onClick={onRemove}
              >
                <XIcon />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {group.conditions.length === 0 ? (
        <p className="text-muted-foreground px-1 py-2 text-sm">
          No conditions yet. Add a rule to get started.
        </p>
      ) : (
        <div
          className={cn(
            "border-border flex flex-col gap-2 border-l-2 pl-2.5",
            hidden && "opacity-50",
          )}
        >
          {group.conditions.map((condition, index) =>
            condition.type === "group" ? (
              <ConditionGroupEditor
                key={condition.id}
                group={condition}
                catalog={catalog}
                depth={depth + 1}
                onChange={(next) => replaceAt(index, next)}
                onRemove={() => removeAt(index)}
              />
            ) : (
              <RuleEditor
                key={condition.id}
                rule={condition}
                catalog={catalog}
                onChange={(next) => replaceAt(index, next)}
                onRemove={() => removeAt(index)}
              />
            ),
          )}
        </div>
      )}

      {group.operator === "not" && group.conditions.length > 1 ? (
        <p className="text-destructive text-xs">NOT groups must contain exactly one condition.</p>
      ) : null}
    </div>
  );
}
