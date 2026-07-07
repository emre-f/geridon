import type {
  IndicatorDefinition,
  IndicatorKind,
  IndicatorSeriesResponse,
  IndicatorSpec,
} from "../types.ts";
import { catalogByKind, indicatorCatalog } from "./indicatorCatalog.ts";
import type { IndicatorCandle } from "./indicatorCalculations.ts";

export { indicatorCatalog } from "./indicatorCatalog.ts";

const maxIndicatorSpecs = 12;

export function isIndicatorKind(value: string): value is IndicatorKind {
  return catalogByKind.has(value);
}

export function indicatorDefinition(kind: IndicatorKind): IndicatorDefinition {
  return catalogByKind.get(kind)!;
}

function normalizedParameter(
  kind: IndicatorKind,
  parameter: IndicatorDefinition["parameters"][number],
  rawValue: unknown,
) {
  const value = rawValue == null ? parameter.default_value : Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${kind}.${parameter.key} must be a finite number.`);
  }

  const normalized = parameter.step >= 1 ? Math.round(value) : value;
  if (normalized < parameter.min || normalized > parameter.max) {
    throw new Error(
      `${kind}.${parameter.key} must be between ${parameter.min} and ${parameter.max}.`,
    );
  }

  return normalized;
}

export function normalizeIndicatorParameters(
  kind: IndicatorKind,
  rawParameters: Record<string, unknown>,
): Record<string, number> {
  const implementation = catalogByKind.get(kind)!;
  const parameters = Object.fromEntries(
    implementation.parameters.map((parameter) => [
      parameter.key,
      normalizedParameter(kind, parameter, rawParameters[parameter.key]),
    ]),
  );

  const constraintError = implementation.validateParameters?.(parameters);
  if (constraintError) {
    throw new Error(constraintError);
  }

  return parameters;
}

function normalizeId(kind: IndicatorKind, rawId: unknown, index: number) {
  if (typeof rawId !== "string") {
    return `${kind}-${index + 1}`;
  }

  const id = rawId.trim().slice(0, 80);
  return id || `${kind}-${index + 1}`;
}

export function normalizeIndicatorSpecs(raw: unknown): IndicatorSpec[] {
  if (!Array.isArray(raw)) {
    throw new Error("indicators must be a JSON array.");
  }
  if (raw.length > maxIndicatorSpecs) {
    throw new Error(`indicators supports up to ${maxIndicatorSpecs} items.`);
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each indicator must be an object.");
    }

    const rawRecord = item as Record<string, unknown>;
    if (typeof rawRecord.kind !== "string" || !isIndicatorKind(rawRecord.kind)) {
      const supported = indicatorCatalog.map((definition) => definition.kind).join(", ");
      throw new Error(`Unsupported indicator kind. Use one of: ${supported}.`);
    }

    const definition = catalogByKind.get(rawRecord.kind)!;
    const rawParameters =
      rawRecord.parameters &&
      typeof rawRecord.parameters === "object" &&
      !Array.isArray(rawRecord.parameters)
        ? (rawRecord.parameters as Record<string, unknown>)
        : {};
    const parameters = normalizeIndicatorParameters(definition.kind, rawParameters);

    return {
      id: normalizeId(definition.kind, rawRecord.id, index),
      kind: definition.kind,
      parameters,
    };
  });
}

function labelFor(definition: IndicatorDefinition, parameters: Record<string, number>) {
  const parts = definition.parameters.map((parameter) => parameters[parameter.key]);
  return parts.length > 0 ? `${definition.label} ${parts.join("/")}` : definition.label;
}

export function computeIndicators(
  candles: IndicatorCandle[],
  specs: IndicatorSpec[],
): IndicatorSeriesResponse[] {
  return specs.map((spec) => {
    const implementation = catalogByKind.get(spec.kind)!;
    const parameters = spec.parameters ?? {};

    return {
      id: spec.id ?? spec.kind,
      kind: spec.kind,
      label: labelFor(implementation, parameters),
      placement: implementation.placement,
      parameters,
      values: implementation.values,
      points: implementation.compute(candles, parameters),
    };
  });
}

export function computeIndicatorValueSeries(
  candles: IndicatorCandle[],
  kind: IndicatorKind,
  parameters: Record<string, number>,
  output: string,
): Array<number | null> {
  const implementation = catalogByKind.get(kind)!;
  return implementation.compute(candles, parameters).map((point) => point.values[output] ?? null);
}
