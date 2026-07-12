import type { ParameterOverride, RuleRole } from "../types.ts";

const ruleRoleValues: RuleRole[] = ["required", "optional", "off"];
const overrideKeys = new Set(["locked", "min", "max", "step", "choices"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseRuleRoles(
  raw: unknown,
): { roles?: Record<string, RuleRole> } | { error: string } {
  if (raw == null) {
    return {};
  }
  if (!isPlainObject(raw)) {
    return { error: "rule_roles must be an object." };
  }
  const roles: Record<string, RuleRole> = {};
  for (const [ruleId, role] of Object.entries(raw)) {
    if (typeof role !== "string" || !ruleRoleValues.includes(role as RuleRole)) {
      return { error: `rule_roles.${ruleId} must be one of required, optional, off.` };
    }
    roles[ruleId] = role as RuleRole;
  }
  return { roles };
}

function parseOverride(id: string, raw: unknown): ParameterOverride | string {
  if (!isPlainObject(raw)) {
    return `parameter_overrides.${id} must be an object.`;
  }
  for (const key of Object.keys(raw)) {
    if (!overrideKeys.has(key)) {
      return `parameter_overrides.${id}.${key} is not a valid override field.`;
    }
  }
  const override: ParameterOverride = {};
  if (raw.locked != null) {
    if (typeof raw.locked !== "boolean") {
      return `parameter_overrides.${id}.locked must be a boolean.`;
    }
    override.locked = raw.locked;
  }
  for (const key of ["min", "max", "step"] as const) {
    if (raw[key] == null) {
      continue;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) {
      return `parameter_overrides.${id}.${key} must be a finite number.`;
    }
    override[key] = value;
  }
  if (override.min != null && override.max != null && override.min >= override.max) {
    return `parameter_overrides.${id}: min must be less than max.`;
  }
  if (override.step != null && override.step <= 0) {
    return `parameter_overrides.${id}.step must be greater than zero.`;
  }
  if (raw.choices != null) {
    if (
      !Array.isArray(raw.choices) ||
      raw.choices.length === 0 ||
      raw.choices.some((choice) => !Number.isFinite(Number(choice)))
    ) {
      return `parameter_overrides.${id}.choices must be a non-empty array of numbers.`;
    }
    override.choices = raw.choices.map(Number);
  }
  return override;
}

export function parseParameterOverrides(
  raw: unknown,
): { overrides?: Record<string, ParameterOverride> } | { error: string } {
  if (raw == null) {
    return {};
  }
  if (!isPlainObject(raw)) {
    return { error: "parameter_overrides must be an object." };
  }
  const overrides: Record<string, ParameterOverride> = {};
  for (const [id, rawOverride] of Object.entries(raw)) {
    const override = parseOverride(id, rawOverride);
    if (typeof override === "string") {
      return { error: override };
    }
    overrides[id] = override;
  }
  return { overrides };
}
