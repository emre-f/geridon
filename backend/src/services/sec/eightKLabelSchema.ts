export const labelKinds = [
  "guidance",
  "buyback",
  "exec_departure_unplanned",
  "exec_departure_routine",
] as const;

export const labelDirections = ["up", "down", "none"] as const;

export type LabelKind = (typeof labelKinds)[number];
export type LabelDirection = (typeof labelDirections)[number];

/**
 * Section 1b's extraction path consumes these figures, so the shape is defined
 * once here rather than duplicated per consumer. `low`/`high` carry a range,
 * `point` a single figure; a filer gives one form or the other, never both.
 * `unit` is mandatory because one filing routinely mixes scales - revenue in
 * billions beside other income in millions - and a raise/cut comparison across
 * two filings is meaningless without it.
 */
export interface GuidanceFigure {
  metric: string;
  period: string;
  unit: string;
  low: number | null;
  high: number | null;
  point: number | null;
}

export interface FilingLabel {
  kind: LabelKind;
  direction: LabelDirection;
  severity: number;
  rationale: string;
  guidance: GuidanceFigure[];
}

export interface FilingLabelSet {
  labels: FilingLabel[];
}

const nullableNumber = { type: ["number", "null"] } as const;

/** Passed to `codex exec --output-schema`; the model returns exactly this shape. */
export const filingLabelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "direction", "severity", "rationale", "guidance"],
        properties: {
          kind: { type: "string", enum: [...labelKinds] },
          direction: { type: "string", enum: [...labelDirections] },
          severity: { type: "integer", minimum: 1, maximum: 5 },
          rationale: { type: "string" },
          guidance: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["metric", "period", "unit", "low", "high", "point"],
              properties: {
                metric: { type: "string" },
                period: { type: "string" },
                unit: { type: "string" },
                low: nullableNumber,
                high: nullableNumber,
                point: nullableNumber,
              },
            },
          },
        },
      },
    },
  },
} as const;

class LabelParseError extends Error {}

function fail(message: string): never {
  throw new LabelParseError(message);
}

function parseGuidance(raw: unknown): GuidanceFigure {
  if (raw == null || typeof raw !== "object") {
    fail("guidance entry is not an object");
  }
  const value = raw as Record<string, unknown>;
  const numberOrNull = (field: string): number | null => {
    const candidate = value[field];
    if (candidate == null) {
      return null;
    }
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      fail(`guidance.${field} is not a finite number or null`);
    }
    return candidate;
  };
  if (
    typeof value.metric !== "string" ||
    typeof value.period !== "string" ||
    typeof value.unit !== "string"
  ) {
    fail("guidance.metric, guidance.period and guidance.unit must be strings");
  }
  return {
    metric: value.metric,
    period: value.period,
    unit: value.unit,
    low: numberOrNull("low"),
    high: numberOrNull("high"),
    point: numberOrNull("point"),
  };
}

function parseLabel(raw: unknown): FilingLabel {
  if (raw == null || typeof raw !== "object") {
    fail("label is not an object");
  }
  const value = raw as Record<string, unknown>;
  if (!labelKinds.includes(value.kind as LabelKind)) {
    fail(`unknown label kind ${JSON.stringify(value.kind)}`);
  }
  if (!labelDirections.includes(value.direction as LabelDirection)) {
    fail(`unknown label direction ${JSON.stringify(value.direction)}`);
  }
  if (
    typeof value.severity !== "number" ||
    !Number.isInteger(value.severity) ||
    value.severity < 1 ||
    value.severity > 5
  ) {
    fail(`severity must be an integer 1-5, got ${JSON.stringify(value.severity)}`);
  }
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0) {
    fail("rationale must be a non-empty string");
  }
  const guidance = value.guidance == null ? [] : value.guidance;
  if (!Array.isArray(guidance)) {
    fail("guidance must be an array");
  }
  return {
    kind: value.kind as LabelKind,
    direction: value.direction as LabelDirection,
    severity: value.severity,
    rationale: value.rationale.trim(),
    guidance: guidance.map(parseGuidance),
  };
}

/**
 * Model output is untrusted: a malformed response must fail the filing, never
 * write a half-valid label into the cache that a later evaluation would trust.
 */
export function parseLabelSet(raw: string): FilingLabelSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`response is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed == null || typeof parsed !== "object" || !Array.isArray((parsed as { labels?: unknown }).labels)) {
    fail("response is missing a labels array");
  }
  return { labels: (parsed as { labels: unknown[] }).labels.map(parseLabel) };
}

export function isLabelParseError(error: unknown): boolean {
  return error instanceof LabelParseError;
}
