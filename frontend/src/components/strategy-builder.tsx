import { useMemo, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  type ComparisonOperator,
  type GroupOperator,
  type IndicatorDefinition,
  type IndicatorValueDefinition,
  type PriceField,
  type StrategyDraft,
  type StrategyGroup,
  type StrategyOperand,
  type StrategyRecord,
  type StrategyRule,
  type StrategyValidationResult,
} from "@/lib/api";
import {
  asRootGroup,
  comparisonOperatorOptions,
  createGroupNode,
  createRuleNode,
  defaultIndicatorOperand,
  describeIssuePath,
  groupOperatorOptions,
  priceFieldOptions,
} from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const groupOperatorHints: Record<GroupOperator, string> = {
  and: "every condition must be true",
  or: "any condition may be true",
  not: "the condition must be false",
};

function Field({
  label,
  labelExtra,
  children,
}: {
  label: string;
  labelExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
        {label}
        {labelExtra}
      </span>
      {children}
    </label>
  );
}

function OutputHelp({ values }: { values: IndicatorValueDefinition[] }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label="Output descriptions"
        onClick={(event) => event.preventDefault()}
        className="border-border text-muted-foreground inline-flex size-3.5 cursor-help items-center justify-center rounded-full border text-[10px] leading-none outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
      >
        ?
      </span>
      <span className="border-border bg-popover text-popover-foreground invisible absolute left-0 top-[calc(100%+0.375rem)] z-50 w-64 rounded-md border p-2 text-[11px] font-normal opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {values.map((value) => {
          const description = value.description?.trim();

          return (
            <span key={value.key} className="block leading-snug">
              <span className="font-medium">{value.label}</span>
              {": "}
              {description ? (
                <span className="text-muted-foreground">{description}</span>
              ) : (
                <span className="text-muted-foreground italic">
                  {"<no description provided>"}
                </span>
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}

function OperandEditor({
  label,
  operand,
  catalog,
  onChange,
}: {
  label: string;
  operand: StrategyOperand;
  catalog: IndicatorDefinition[];
  onChange: (operand: StrategyOperand) => void;
}) {
  const definition =
    operand.type === "indicator"
      ? catalog.find((entry) => entry.kind === operand.kind)
      : undefined;

  function changeType(type: string) {
    if (type === operand.type) {
      return;
    }
    if (type === "indicator" && catalog.length > 0) {
      onChange(defaultIndicatorOperand(catalog[0]));
    } else if (type === "price") {
      onChange({ type: "price", field: "close" });
    } else if (type === "value") {
      onChange({ type: "value", value: 0 });
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <Field label={label}>
        <Select
          value={operand.type}
          aria-label={`${label} source`}
          className="w-28"
          onChange={(event) => changeType(event.target.value)}
        >
          <option value="indicator">Indicator</option>
          <option value="price">Price</option>
          <option value="value">Value</option>
        </Select>
      </Field>

      {operand.type === "indicator" ? (
        <>
          <Field label="Indicator">
            <Select
              value={operand.kind}
              aria-label={`${label} indicator`}
              className="w-28"
              onChange={(event) => {
                const nextDefinition = catalog.find((entry) => entry.kind === event.target.value);
                if (nextDefinition) {
                  onChange(defaultIndicatorOperand(nextDefinition));
                }
              }}
            >
              {catalog.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          {definition && definition.values.length > 1 ? (
            <Field label="Output" labelExtra={<OutputHelp values={definition.values} />}>
              <Select
                value={operand.output}
                aria-label={`${label} output`}
                className="w-26"
                onChange={(event) => onChange({ ...operand, output: event.target.value })}
              >
                {definition.values.map((value) => (
                  <option key={value.key} value={value.key}>
                    {value.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition?.parameters.map((parameter) => (
            <Field key={parameter.key} label={parameter.label}>
              <NumberInput
                className="w-20"
                aria-label={`${label} ${definition.label} ${parameter.label}`}
                value={operand.parameters[parameter.key] ?? parameter.default_value}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                onValueChange={(value) =>
                  onChange({
                    ...operand,
                    parameters: { ...operand.parameters, [parameter.key]: value },
                  })
                }
              />
            </Field>
          ))}
        </>
      ) : null}

      {operand.type === "price" ? (
        <Field label="Field">
          <Select
            value={operand.field}
            aria-label={`${label} price field`}
            className="w-24"
            onChange={(event) => onChange({ ...operand, field: event.target.value as PriceField })}
          >
            {priceFieldOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {operand.type === "value" ? (
        <Field label="Number">
          <NumberInput
            className="w-24"
            aria-label={`${label} value`}
            value={operand.value}
            step={0.01}
            onValueChange={(value) => onChange({ ...operand, value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * Eye toggle shared by rules and groups. A hidden condition stays fully
 * editable but is skipped during evaluation, so its effect can be previewed
 * without deleting it.
 */
function VisibilityToggle({
  hidden,
  subject,
  onToggle,
}: {
  hidden: boolean;
  subject: "rule" | "group";
  onToggle: () => void;
}) {
  const label = hidden ? `Show ${subject}` : `Hide ${subject} from evaluation`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-8",
        hidden ? "text-muted-foreground/70 hover:text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      onClick={onToggle}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </Button>
  );
}

function RuleEditor({
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

  return (
    <div
      className={cn(
        "border-border bg-background flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border p-2.5",
        hidden && "border-dashed",
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

function ConditionGroupEditor({
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
          <ToggleGroup
            type="single"
            value={group.operator}
            aria-label="Group operator"
            onValueChange={(value) =>
              value && onChange({ ...group, operator: value as GroupOperator })
            }
          >
            {groupOperatorOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {groupOperatorHints[group.operator]}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={() => append(createRuleNode(catalog))}>
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

interface StrategyBuilderProps {
  catalog: IndicatorDefinition[];
  strategies: StrategyRecord[];
  selectedId: number | null;
  draft: StrategyDraft | null;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  validating: boolean;
  validation: StrategyValidationResult | null;
  error: string | null;
  onDraftChange: (draft: StrategyDraft) => void;
  onSelectStrategy: (value: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onValidate: () => void;
  onSave: () => void;
}

/**
 * Visual rule builder for trading strategies. Strategies are validated by the
 * backend and stored in SQLite, so they survive browser storage resets.
 */
export function StrategyBuilder({
  catalog,
  strategies,
  selectedId,
  draft,
  dirty,
  loading,
  saving,
  validating,
  validation,
  error,
  onDraftChange,
  onSelectStrategy,
  onDuplicate,
  onDelete,
  onValidate,
  onSave,
}: StrategyBuilderProps) {
  const catalogReady = catalog.length > 0;
  const entryGroup = useMemo(
    () => (draft ? asRootGroup(draft.entry) : null),
    [draft],
  );
  const exitGroup = useMemo(() => (draft ? asRootGroup(draft.exit) : null), [draft]);

  function editDraft(update: (draft: StrategyDraft) => StrategyDraft) {
    if (!draft) {
      return;
    }
    onDraftChange(update(draft));
  }

  return (
    <Card className="gap-4">
      <CardHeader className="gap-4 px-4 sm:px-5 lg:flex lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-xl">Strategy builder</CardTitle>
          <CardDescription>
            Combine indicators, price, and fixed values into entry and exit rules. Strategies are
            validated and stored in the database.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedId == null ? "new" : String(selectedId)}
            aria-label="Stored strategies"
            className="w-48"
            disabled={!catalogReady}
            onChange={(event) => onSelectStrategy(event.target.value)}
          >
            <option value="new">(New)</option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            title="Copy this strategy (including unsaved edits) into a new one, keeping the original as is"
            onClick={onDuplicate}
            disabled={selectedId == null || !draft || saving}
          >
            <CopyIcon />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDelete}
            disabled={selectedId == null || saving}
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
        {loading || !draft || !entryGroup || !exitGroup ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Name">
                <Input
                  value={draft.name}
                  maxLength={80}
                  aria-label="Strategy name"
                  className="w-64"
                  onChange={(event) =>
                    editDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </Field>
              {dirty ? (
                <Badge variant="secondary" className="mb-1.5">
                  Unsaved changes
                </Badge>
              ) : null}
            </div>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge className="border-transparent bg-[var(--chart-up-muted)] text-[var(--chart-up)]">
                  Entry
                </Badge>
                <span className="text-muted-foreground text-xs">
                  Buy when these conditions are met
                </span>
              </div>
              <ConditionGroupEditor
                group={entryGroup}
                catalog={catalog}
                depth={0}
                onChange={(next) => editDraft((current) => ({ ...current, entry: next }))}
              />
            </section>

            <Separator />

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge className="border-transparent bg-[var(--chart-down-muted)] text-[var(--chart-down)]">
                  Exit
                </Badge>
                <span className="text-muted-foreground text-xs">
                  Sell when these conditions are met
                </span>
              </div>
              <ConditionGroupEditor
                group={exitGroup}
                catalog={catalog}
                depth={0}
                onChange={(next) => editDraft((current) => ({ ...current, exit: next }))}
              />
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onValidate}
                disabled={validating || saving}
              >
                {validating ? <RefreshCwIcon className="animate-spin" /> : <CheckIcon />}
                Validate
              </Button>
              <Button type="button" onClick={onSave} disabled={saving || validating}>
                {saving ? <RefreshCwIcon className="animate-spin" /> : <SaveIcon />}
                {selectedId == null ? "Save strategy" : "Save changes"}
              </Button>
              {validation?.valid ? (
                <span className="flex items-center gap-1.5 text-sm text-[var(--chart-up)]">
                  <CheckIcon className="size-4" />
                  Strategy is valid and ready to run.
                </span>
              ) : null}
            </div>

            {validation && !validation.valid ? (
              <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
                <p className="text-destructive text-sm font-medium">
                  Fix these issues before running the strategy:
                </p>
                <ul className="text-destructive mt-1.5 flex flex-col gap-1 text-sm">
                  {validation.errors.map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <span className="font-medium">{describeIssuePath(issue.path)}:</span>{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
