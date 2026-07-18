import {
  indicatorCatalog,
  indicatorDefinition,
  isIndicatorKind,
  normalizeIndicatorParameters,
} from "./indicators.ts";
import {
  isRecord,
  issue,
  priceFields,
  signalOutputs,
  type ValidationContext,
} from "./strategyValidationHelpers.ts";
import type { PriceField, SignalOperand, SignalOutput, StrategyOperand } from "../types.ts";
import { eventKinds, isEventKind } from "../types/events.ts";

export function validateOperand(
  raw: unknown,
  path: string,
  context: ValidationContext,
): StrategyOperand | null {
  if (!isRecord(raw)) {
    issue(context, path, "Operand must be an object.");
    return null;
  }

  if (raw.type === "indicator") {
    if (typeof raw.kind !== "string" || !isIndicatorKind(raw.kind)) {
      const supported = indicatorCatalog.map((definition) => definition.kind).join(", ");
      issue(context, path, `Unsupported indicator kind. Use one of: ${supported}.`);
      return null;
    }

    const definition = indicatorDefinition(raw.kind);
    const outputKeys = definition.values.map((value) => value.key);
    const output = raw.output == null ? outputKeys[0] : raw.output;
    if (typeof output !== "string" || !outputKeys.includes(output)) {
      issue(
        context,
        path,
        `Unknown ${definition.kind} output. Use one of: ${outputKeys.join(", ")}.`,
      );
      return null;
    }

    try {
      const parameters = normalizeIndicatorParameters(
        definition.kind,
        isRecord(raw.parameters) ? raw.parameters : {},
      );
      return { type: "indicator", kind: definition.kind, parameters, output };
    } catch (error) {
      issue(context, path, error instanceof Error ? error.message : "Invalid indicator parameters.");
      return null;
    }
  }

  if (raw.type === "price") {
    if (typeof raw.field !== "string" || !priceFields.includes(raw.field as PriceField)) {
      issue(context, path, `Price field must be one of: ${priceFields.join(", ")}.`);
      return null;
    }
    return { type: "price", field: raw.field as PriceField };
  }

  if (raw.type === "value") {
    const value = Number(raw.value);
    if (typeof raw.value !== "number" || !Number.isFinite(value)) {
      issue(context, path, "Value must be a finite number.");
      return null;
    }
    return { type: "value", value };
  }

  if (raw.type === "signal") {
    return validateSignalOperand(raw, path, context);
  }

  issue(context, path, 'Operand type must be "indicator", "price", "value", or "signal".');
  return null;
}

function validateSignalOperand(
  raw: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): SignalOperand | null {
  if (typeof raw.kind !== "string" || !isEventKind(raw.kind)) {
    issue(context, path, `Unknown event kind. Use one of: ${eventKinds.join(", ")}.`);
    return null;
  }

  if (typeof raw.output !== "string" || !signalOutputs.includes(raw.output as SignalOutput)) {
    issue(context, path, `Signal output must be one of: ${signalOutputs.join(", ")}.`);
    return null;
  }
  const output = raw.output as SignalOutput;

  if (output === "count_in_window") {
    if (typeof raw.window !== "number" || !Number.isInteger(raw.window) || raw.window < 1) {
      issue(context, path, "count_in_window requires a positive integer window of bars.");
      return null;
    }
  } else if (raw.window != null) {
    issue(context, path, `Signal output ${output} does not take a window.`);
    return null;
  }

  let filters: Record<string, number> | undefined;
  if (raw.filters != null) {
    if (!isRecord(raw.filters)) {
      issue(context, path, "Signal filters must be an object of numeric thresholds.");
      return null;
    }
    for (const [key, value] of Object.entries(raw.filters)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issue(context, path, `Signal filter "${key}" must be a finite number.`);
        return null;
      }
    }
    if (Object.keys(raw.filters).length > 0) {
      filters = raw.filters as Record<string, number>;
    }
  }

  return {
    type: "signal",
    kind: raw.kind,
    output,
    ...(output === "count_in_window" ? { window: raw.window as number } : {}),
    ...(filters ? { filters } : {}),
  };
}

/**
 * Parses the optional per-condition enabled flag. Only `false` is stored so
 * existing strategies (which predate the flag) keep their exact shape.
 */
export function validateEnabled(
  raw: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): { enabled: false } | Record<string, never> | null {
  if (raw.enabled != null && typeof raw.enabled !== "boolean") {
    issue(context, path, "Condition enabled flag must be a boolean.");
    return null;
  }
  return raw.enabled === false ? { enabled: false } : {};
}
