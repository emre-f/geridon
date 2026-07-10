import {
  indicatorCatalog,
  indicatorDefinition,
  isIndicatorKind,
  normalizeIndicatorParameters,
} from "./indicators.ts";
import { isRecord, issue, priceFields, type ValidationContext } from "./strategyValidationHelpers.ts";
import type { PriceField, StrategyOperand } from "../types.ts";

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

  issue(context, path, 'Operand type must be "indicator", "price", or "value".');
  return null;
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
