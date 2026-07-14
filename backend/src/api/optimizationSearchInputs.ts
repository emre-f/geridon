import type {
  OptimizationObjective,
  ParameterOverride,
  RuleRole,
  ScoringConfig,
} from "../types.ts";

const ruleRoleValues: RuleRole[] = ["required", "optional", "off"];
const overrideKeys = new Set(["locked", "min", "max", "step", "choices"]);

export const scoringLimits = {
  maxPenaltyWeight: 10,
  maxMinTotalTrades: 10_000,
};

const objectiveValues: OptimizationObjective[] = ["sharpe", "annualized_return", "total_return"];
const penaltyKeys = ["drawdown", "instability", "turnover", "complexity"] as const;
const constraintKeys = ["minTotalTrades", "maxDrawdownPct", "minPositiveFoldFraction"] as const;

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

function parsePenalties(raw: unknown): Partial<ScoringConfig["penalties"]> | string {
  if (!isPlainObject(raw)) {
    return "scoring.penalties must be an object.";
  }
  const penalties: Partial<ScoringConfig["penalties"]> = {};
  for (const key of Object.keys(raw)) {
    if (!penaltyKeys.includes(key as (typeof penaltyKeys)[number])) {
      return `scoring.penalties.${key} is not a valid penalty weight.`;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < 0 || value > scoringLimits.maxPenaltyWeight) {
      return `scoring.penalties.${key} must be a number between 0 and ${scoringLimits.maxPenaltyWeight}.`;
    }
    penalties[key as (typeof penaltyKeys)[number]] = value;
  }
  return penalties;
}

function parseConstraints(raw: unknown): Partial<ScoringConfig["constraints"]> | string {
  if (!isPlainObject(raw)) {
    return "scoring.constraints must be an object.";
  }
  const constraints: Partial<ScoringConfig["constraints"]> = {};
  for (const key of Object.keys(raw)) {
    if (!constraintKeys.includes(key as (typeof constraintKeys)[number])) {
      return `scoring.constraints.${key} is not a valid constraint.`;
    }
  }
  if (raw.minTotalTrades != null) {
    const value = Number(raw.minTotalTrades);
    if (!Number.isInteger(value) || value < 0 || value > scoringLimits.maxMinTotalTrades) {
      return `scoring.constraints.minTotalTrades must be an integer between 0 and ${scoringLimits.maxMinTotalTrades}.`;
    }
    constraints.minTotalTrades = value;
  }
  if (raw.maxDrawdownPct != null) {
    const value = Number(raw.maxDrawdownPct);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return "scoring.constraints.maxDrawdownPct must be a number between 0 and 100.";
    }
    constraints.maxDrawdownPct = value;
  }
  if (raw.minPositiveFoldFraction != null) {
    const value = Number(raw.minPositiveFoldFraction);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return "scoring.constraints.minPositiveFoldFraction must be a number between 0 and 1.";
    }
    constraints.minPositiveFoldFraction = value;
  }
  return constraints;
}

export function parseScoringConfig(
  raw: unknown,
): { scoring?: Partial<ScoringConfig> } | { error: string } {
  if (raw == null) {
    return {};
  }
  if (!isPlainObject(raw)) {
    return { error: "scoring must be an object." };
  }
  const scoring: Partial<ScoringConfig> = {};
  for (const key of Object.keys(raw)) {
    if (key !== "objective" && key !== "penalties" && key !== "constraints") {
      return { error: `scoring.${key} is not a valid scoring field.` };
    }
  }
  if (raw.objective != null) {
    if (
      typeof raw.objective !== "string" ||
      !objectiveValues.includes(raw.objective as OptimizationObjective)
    ) {
      return { error: `scoring.objective must be one of ${objectiveValues.join(", ")}.` };
    }
    scoring.objective = raw.objective as OptimizationObjective;
  }
  if (raw.penalties != null) {
    const penalties = parsePenalties(raw.penalties);
    if (typeof penalties === "string") {
      return { error: penalties };
    }
    scoring.penalties = penalties as ScoringConfig["penalties"];
  }
  if (raw.constraints != null) {
    const constraints = parseConstraints(raw.constraints);
    if (typeof constraints === "string") {
      return { error: constraints };
    }
    scoring.constraints = constraints as ScoringConfig["constraints"];
  }
  return Object.keys(scoring).length > 0 ? { scoring } : {};
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
