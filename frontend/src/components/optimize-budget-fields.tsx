import type { OptimizationMethod } from "@/lib/api";
import {
  budgetPresetLabels,
  type BudgetPreset,
  type BudgetPresetChoice,
} from "@/lib/optimize-preflight-utils";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

export function OptimizeBudgetFields({
  foldCount,
  holdoutPct,
  maxTrials,
  method,
  preset,
  onFoldCountChange,
  onHoldoutPctChange,
  onMaxTrialsChange,
  onMethodChange,
  onPresetChange,
}: {
  foldCount: number;
  holdoutPct: number;
  maxTrials: number;
  method: OptimizationMethod;
  preset: BudgetPresetChoice;
  onFoldCountChange: (value: number) => void;
  onHoldoutPctChange: (value: number) => void;
  onMaxTrialsChange: (value: number) => void;
  onMethodChange: (value: OptimizationMethod) => void;
  onPresetChange: (value: BudgetPreset) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <Field label="Method">
          <Select
            value={method}
            aria-label="Search method"
            className="w-44"
            onChange={(event) => onMethodChange(event.target.value as OptimizationMethod)}
          >
            <option value="random">Seeded random search</option>
            <option value="tpe">Bayesian (TPE)</option>
          </Select>
        </Field>
        <Field label="Budget">
          <Select
            value={preset}
            aria-label="Budget preset"
            className="w-28"
            onChange={(event) => {
              if (event.target.value !== "custom") {
                onPresetChange(event.target.value as BudgetPreset);
              }
            }}
          >
            {(["quick", "standard", "thorough"] as const).map((value) => (
              <option key={value} value={value}>
                {budgetPresetLabels[value]}
              </option>
            ))}
            <option value="custom" disabled>
              {budgetPresetLabels.custom}
            </option>
          </Select>
        </Field>
      </div>
      <div className="flex items-end gap-3">
        <Field label="Total trial budget">
          <NumberInput
            className="w-20"
            aria-label="Total trial budget"
            value={maxTrials}
            min={1}
            max={500}
            step={1}
            onValueChange={onMaxTrialsChange}
          />
        </Field>
        <Field label="Folds">
          <NumberInput
            className="w-16"
            aria-label="Fold count"
            value={foldCount}
            min={2}
            max={12}
            step={1}
            onValueChange={onFoldCountChange}
          />
        </Field>
        <Field label="Sealed holdout">
          <Select
            value={String(holdoutPct)}
            aria-label="Sealed holdout percent"
            className="w-24"
            onChange={(event) => onHoldoutPctChange(Number(event.target.value))}
          >
            <option value="0">None</option>
            {[10, 15, 20, 25, 30].map((pct) => (
              <option key={pct} value={pct}>
                {pct}%
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
