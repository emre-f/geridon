import type {
  IndicatorDefinition,
  PriceField,
  StrategyOperand,
} from "@/lib/api";
import {
  defaultIndicatorOperand,
  priceFieldOptions,
} from "@/lib/strategy";
import { OutputHelp } from "@/components/strategy-output-help";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

export function OperandEditor({
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
