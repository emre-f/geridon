import * as React from "react";

import { Input } from "@/components/ui/input";

function decimalPlaces(step: number) {
  const text = step.toString();
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

type NumberInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "min" | "max" | "step" | "inputMode"
> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

function NumberInput({
  value,
  onValueChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  onBlur,
  onKeyDown,
  ...props
}: NumberInputProps) {
  // While the user is typing, `draft` holds the raw text (including transient
  // states like "" or "1.") so the field never fights their edits; the value is
  // only parsed and clamped on commit (blur / Enter / arrow keys).
  const [draft, setDraft] = React.useState<string | null>(null);
  const precision = decimalPlaces(step);
  const allowDecimal = precision > 0;
  const allowNegative = min < 0;
  const partialPattern = React.useMemo(
    () =>
      new RegExp(
        `^${allowNegative ? "-?" : ""}\\d*${allowDecimal ? "(?:\\.\\d*)?" : ""}$`,
      ),
    [allowDecimal, allowNegative],
  );

  function clampToRange(next: number) {
    return Math.min(Math.max(next, min), max);
  }

  function commit(raw: string) {
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) {
      onValueChange(clampToRange(Number(parsed.toFixed(precision))));
    }
    setDraft(null);
  }

  function nudge(direction: 1 | -1) {
    const parsedDraft = draft == null ? Number.NaN : Number(draft);
    const current =
      draft != null && draft.trim() !== "" && Number.isFinite(parsedDraft)
        ? parsedDraft
        : value;
    onValueChange(
      clampToRange(Number((current + direction * step).toFixed(precision))),
    );
    setDraft(null);
  }

  return (
    <Input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      autoComplete="off"
      value={draft ?? String(value)}
      onChange={(event) => {
        const next = event.target.value;
        if (partialPattern.test(next)) {
          setDraft(next);
        }
      }}
      onBlur={(event) => {
        commit(event.target.value);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          setDraft(null);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          nudge(1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          nudge(-1);
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

export { NumberInput };
