import { canonicalRuleKey, ruleRejectionReason } from "../services/optimization/cheapRejection.ts";
import { evolutionLimits } from "../services/optimization/evolution.ts";
import { validateRule } from "../services/strategies.ts";
import type { EvolutionSearchConfig, StrategyRule } from "../types.ts";

const evolutionKeys = new Set([
  "populationSize",
  "eliteCount",
  "ruleLibrary",
  "insertionPoints",
  "maxNewRulesPerSide",
  "maxActiveRulesPerSide",
  "maxUniqueIndicatorsPerSide",
  "maxTreeDepth",
]);

const capBounds = {
  populationSize: { min: 2, max: evolutionLimits.maxPopulation },
  eliteCount: { min: 1, max: evolutionLimits.maxPopulation },
  maxNewRulesPerSide: { min: 0, max: evolutionLimits.maxNewRulesPerSide },
  maxActiveRulesPerSide: { min: 1, max: evolutionLimits.maxActiveRulesPerSide },
  maxUniqueIndicatorsPerSide: { min: 1, max: evolutionLimits.maxUniqueIndicatorsPerSide },
  maxTreeDepth: { min: 1, max: evolutionLimits.maxTreeDepth },
} as const;

const insertionPointPattern = /^(entry|exit|cash)(\.conditions\.\d+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseRuleLibrary(raw: unknown): { rules: StrategyRule[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "evolution.ruleLibrary must be an array of rules." };
  }
  if (raw.length > evolutionLimits.maxRuleLibrary) {
    return {
      error: `evolution.ruleLibrary must contain at most ${evolutionLimits.maxRuleLibrary} rules.`,
    };
  }
  const rules: StrategyRule[] = [];
  const seen = new Set<string>();
  for (const [index, rawRule] of raw.entries()) {
    const path = `evolution.ruleLibrary[${index}]`;
    const { rule, errors } = validateRule(rawRule, path);
    if (rule == null || rule.type !== "rule") {
      const first = errors[0];
      return { error: first ? `${first.path || path}: ${first.message}` : `${path} is invalid.` };
    }
    const rejection = ruleRejectionReason(rule);
    if (rejection) {
      return { error: `${path}: ${rejection}.` };
    }
    const key = canonicalRuleKey(rule);
    if (seen.has(key)) {
      return { error: `${path}: duplicate of an earlier library rule.` };
    }
    seen.add(key);
    rules.push(rule);
  }
  return { rules };
}

function parseInsertionPoints(raw: unknown): { points: string[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "evolution.insertionPoints must be an array of strategy paths." };
  }
  if (raw.length > evolutionLimits.maxInsertionPoints) {
    return {
      error: `evolution.insertionPoints must contain at most ${evolutionLimits.maxInsertionPoints} paths.`,
    };
  }
  const points: string[] = [];
  for (const point of raw) {
    if (typeof point !== "string" || !insertionPointPattern.test(point)) {
      return {
        error: `evolution.insertionPoints entries must look like "entry" or "entry.conditions.0".`,
      };
    }
    if (points.includes(point)) {
      return { error: `evolution.insertionPoints contains ${point} more than once.` };
    }
    points.push(point);
  }
  return { points };
}

/**
 * Validates the Mode C evolution settings with structured errors instead of
 * an unchecked cast: library rules must be catalog-valid non-degenerate
 * single rules, insertion points must be strategy paths, and caps can only
 * be tightened within hard bounds. Whether each insertion point resolves to
 * an enabled and/or group is checked later against the loaded strategy.
 */
export function parseEvolutionConfig(
  raw: unknown,
): { evolution?: Partial<EvolutionSearchConfig> } | { error: string } {
  if (raw == null) {
    return {};
  }
  if (!isPlainObject(raw)) {
    return { error: "evolution must be an object." };
  }
  for (const key of Object.keys(raw)) {
    if (!evolutionKeys.has(key)) {
      return { error: `evolution.${key} is not a valid evolution setting.` };
    }
  }

  const evolution: Partial<EvolutionSearchConfig> = {};
  for (const key of Object.keys(capBounds) as Array<keyof typeof capBounds>) {
    if (raw[key] == null) {
      continue;
    }
    const bounds = capBounds[key];
    const value = Number(raw[key]);
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      return {
        error: `evolution.${key} must be an integer between ${bounds.min} and ${bounds.max}.`,
      };
    }
    evolution[key] = value;
  }
  if (
    evolution.eliteCount != null &&
    evolution.populationSize != null &&
    evolution.eliteCount > evolution.populationSize
  ) {
    return { error: "evolution.eliteCount must not exceed evolution.populationSize." };
  }

  if (raw.ruleLibrary != null) {
    const library = parseRuleLibrary(raw.ruleLibrary);
    if ("error" in library) {
      return { error: library.error };
    }
    evolution.ruleLibrary = library.rules;
  }
  if (raw.insertionPoints != null) {
    const points = parseInsertionPoints(raw.insertionPoints);
    if ("error" in points) {
      return { error: points.error };
    }
    evolution.insertionPoints = points.points;
  }
  return { evolution };
}
