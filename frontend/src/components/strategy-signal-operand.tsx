import { XIcon } from "lucide-react";

import type { SignalEventKind, SignalOperand, SignalOutput } from "@/lib/api";
import {
  signalCatalog,
  signalKindDefinition,
  signalOutputOptions,
  type SignalFilterField,
} from "@/lib/signal-catalog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

const defaultCountWindow = 20;
const maxCountWindow = 250;

function withFilters(operand: SignalOperand, filters: Record<string, number>): SignalOperand {
  const { filters: _dropped, ...rest } = operand;
  return Object.keys(filters).length > 0 ? { ...rest, filters } : rest;
}

function OutputsHelp() {
  return (
    <HelpTip ariaLabel="Signal output descriptions">
      {signalOutputOptions.map((option) => (
        <span key={option.value} className="block leading-snug">
          <span className="font-medium">{option.label}</span>
          {": "}
          <span className="text-muted-foreground">{option.description}</span>
        </span>
      ))}
    </HelpTip>
  );
}

function FiltersHelp() {
  return (
    <HelpTip ariaLabel="About signal filters">
      <span className="block font-medium">Filters</span>
      <span className="text-muted-foreground block leading-snug">
        Minimum thresholds an event must meet to count for this operand:
      </span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} Numeric fields compare as value at least threshold.
      </span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} Flag fields (officers, directors, owners) require the flag to be set.
      </span>
    </HelpTip>
  );
}

export function SignalOperandFields({
  label,
  operand,
  onChange,
}: {
  label: string;
  operand: SignalOperand;
  onChange: (operand: SignalOperand) => void;
}) {
  const definition = signalKindDefinition(operand.kind);
  const filters = operand.filters ?? {};
  const filterFields = definition?.filterFields ?? [];
  const activeFields = filterFields.filter((field) => field.key in filters);
  const availableFields = filterFields.filter((field) => !(field.key in filters));

  function changeKind(kind: SignalEventKind) {
    onChange(withFilters({ ...operand, kind }, {}));
  }

  function changeOutput(output: SignalOutput) {
    const { window: _dropped, ...rest } = operand;
    onChange(
      output === "count_in_window"
        ? { ...rest, output, window: operand.window ?? defaultCountWindow }
        : { ...rest, output },
    );
  }

  function addFilter(field: SignalFilterField) {
    onChange(withFilters(operand, { ...filters, [field.key]: field.boolean ? 1 : 0 }));
  }

  function removeFilter(key: string) {
    const { [key]: _removed, ...rest } = filters;
    onChange(withFilters(operand, rest));
  }

  return (
    <>
      <Field label="Event">
        <Select
          value={operand.kind}
          aria-label={`${label} event kind`}
          title={definition?.description}
          className="w-40"
          onChange={(event) => changeKind(event.target.value as SignalEventKind)}
        >
          {signalCatalog.map((entry) => (
            <option key={entry.kind} value={entry.kind} title={entry.description}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Output" labelExtra={<OutputsHelp />}>
        <Select
          value={operand.output}
          aria-label={`${label} signal output`}
          className="w-34"
          onChange={(event) => changeOutput(event.target.value as SignalOutput)}
        >
          {signalOutputOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {operand.output === "count_in_window" ? (
        <Field label="Window (bars)">
          <NumberInput
            className="w-20"
            aria-label={`${label} signal window in bars`}
            value={operand.window ?? defaultCountWindow}
            min={1}
            max={maxCountWindow}
            step={1}
            onValueChange={(value) => onChange({ ...operand, window: value })}
          />
        </Field>
      ) : null}

      {activeFields.map((field) => (
        <Field key={field.key} label={field.label}>
          <div className="flex items-center gap-1">
            {field.boolean ? null : (
              <NumberInput
                className="w-24"
                aria-label={`${label} ${field.label}`}
                value={filters[field.key] ?? 0}
                step={field.step}
                onValueChange={(value) =>
                  onChange(withFilters(operand, { ...filters, [field.key]: value }))
                }
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Remove ${field.label} filter`}
              onClick={() => removeFilter(field.key)}
            >
              <XIcon />
            </Button>
          </div>
        </Field>
      ))}

      {availableFields.length > 0 ? (
        <Field label="Filters" labelExtra={<FiltersHelp />}>
          <Select
            value=""
            aria-label={`${label} add signal filter`}
            className="w-30"
            onChange={(event) => {
              const field = availableFields.find((entry) => entry.key === event.target.value);
              if (field) {
                addFilter(field);
              }
            }}
          >
            <option value="">Add filter</option>
            {availableFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
