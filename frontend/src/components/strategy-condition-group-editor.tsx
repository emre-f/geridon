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
import { SlashTabs } from "@/components/ui/slash-tabs";

const groupOperatorHints: Record<GroupOperator, string> = {
  and: "every condition must be true",
  or: "any condition may be true",
  not: "the condition must be false",
};

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

  function replaceAt(index: number, condition: StrategyGroup | StrategyRule) {
    onChange({
      ...group,
      conditions: group.conditions.map((current, currentIndex) =>
        currentIndex === index ? condition : current,
      ),
    });
  }

  function removeAt(index: number) {
    onChange({
      ...group,
      conditions: group.conditions.filter((_, currentIndex) => currentIndex !== index),
    });
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
            onValueChange={(value) => onChange({ ...group, operator: value as GroupOperator })}
          />
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {groupOperatorHints[group.operator]}
          </span>
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
