import type { Database } from "../db.ts";
import type { EvaluationSettings } from "../services/optimization/evaluate.ts";
import { createIndicatorSeriesCache } from "../services/optimization/indicatorCache.ts";
import {
  activeRuleCount,
  benchmarkBaseline,
  buildPreflightTimeline,
  planEvaluations,
} from "../services/optimization/preflight.ts";
import { resolveScoringConfig } from "../services/optimization/scoring.ts";
import type { ExperimentPreflight } from "../types.ts";
import { parseExperimentRequest } from "./optimizationRequests.ts";
import { prepareExperimentInputs } from "./optimizationSetup.ts";
import { badRequest, type ApiResult } from "./shared.ts";

/**
 * Validates a draft experiment exactly like creation would, then returns the
 * planned backtest-evaluation count, a runtime estimate from a small timed
 * benchmark of the baseline on the selected data, and the Search/Train,
 * Validation, and Sealed Test windows. Persists nothing and queues nothing.
 */
export function handlePreflightExperiment(db: Database, body: unknown): ApiResult {
  const parsed = parseExperimentRequest(body);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }
  const { config } = parsed;

  const prepared = prepareExperimentInputs(db, config);
  if ("failure" in prepared) {
    return prepared.failure;
  }
  const { strategy, datasets, searchData, foldsBySymbol } = prepared.inputs;

  const scoring = resolveScoringConfig(config.scoring);
  const settings: EvaluationSettings = {
    positionMode: config.position_mode,
    buyPercent: config.buy_percent,
    sellPercent: config.sell_percent,
    initialCapital: config.initial_capital,
    costs: config.costs,
    objective: scoring.objective,
    cache: createIndicatorSeriesCache(),
  };

  const benchmark = benchmarkBaseline(strategy, searchData, foldsBySymbol, settings);
  const evaluations = planEvaluations({
    method: config.method,
    maxTrials: config.max_trials,
    foldsBySymbol,
    halving: config.halving,
    refinement: config.refinement,
    activeRuleCount: activeRuleCount(strategy),
  });
  const estimatedRuntimeMs = Math.round(evaluations.total * benchmark.ms_per_evaluation);

  const preflight: ExperimentPreflight = {
    evaluations,
    benchmark,
    estimated_runtime_ms: estimatedRuntimeMs,
    max_runtime_ms: config.max_runtime_ms,
    runtime_capped: estimatedRuntimeMs > config.max_runtime_ms,
    timeline: buildPreflightTimeline(datasets, searchData, foldsBySymbol, config.holdout),
  };
  return { statusCode: 200, body: preflight };
}
