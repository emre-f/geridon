import type { Database } from "../db.ts";
import { baselineEvolutionCaps, evolutionLimits } from "../services/optimization/evolution.ts";
import {
  buildRuleLibraryTemplates,
  collectInsertionPoints,
} from "../services/optimization/ruleLibrary.ts";
import type { RuleLibraryResponse, Strategy } from "../types.ts";
import { badRequest, type ApiResult } from "./shared.ts";

/**
 * Seeded candidate-rule templates plus the strategy's approvable insertion
 * points, so the experiment form can offer a Mode C library the user
 * explicitly approves before anything runs. Read-only.
 */
export function handleGetRuleLibrary(db: Database, strategyIdRaw: string | null): ApiResult {
  const strategyId = Number(strategyIdRaw);
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    return badRequest("strategy_id must be a positive integer.");
  }
  const row = db
    .prepare("SELECT definition FROM strategies WHERE id = ?")
    .get(strategyId) as { definition: string } | undefined;
  if (!row) {
    return { statusCode: 404, body: { detail: `Strategy ${strategyId} was not found.` } };
  }
  const strategy = JSON.parse(String(row.definition)) as Strategy;

  const body: RuleLibraryResponse = {
    strategy_id: strategyId,
    templates: buildRuleLibraryTemplates(strategy),
    insertion_points: collectInsertionPoints(strategy),
    cap_defaults: baselineEvolutionCaps(strategy),
    limits: {
      maxRuleLibrary: evolutionLimits.maxRuleLibrary,
      maxNewRulesPerSide: evolutionLimits.maxNewRulesPerSide,
      maxActiveRulesPerSide: evolutionLimits.maxActiveRulesPerSide,
      maxUniqueIndicatorsPerSide: evolutionLimits.maxUniqueIndicatorsPerSide,
      maxTreeDepth: evolutionLimits.maxTreeDepth,
    },
  };
  return { statusCode: 200, body };
}
