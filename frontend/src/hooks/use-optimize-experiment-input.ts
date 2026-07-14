import { useMemo } from "react";

import { dayEndMs, dayStartMs } from "@/lib/backtest-utils";
import { buildScoringConfig, scoringIssue } from "@/lib/optimize-scoring-utils";
import type { useOptimizeExperimentForm } from "@/hooks/use-optimize-experiment-form";
import type { useOptimizeRuleLibrary } from "@/hooks/use-optimize-rule-library";
import type { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";

/** The create/preflight request for the current form state, or null while the
 * configuration is incomplete or pre-validation fails. Mode A (tune) never
 * sends rule roles; only deviations from the scoring defaults are sent. */
export function useOptimizeExperimentInput(
  form: ReturnType<typeof useOptimizeExperimentForm>,
  searchSpace: ReturnType<typeof useOptimizeSearchSpace>,
  ruleLibrary: ReturnType<typeof useOptimizeRuleLibrary>,
) {
  const evolving = form.mode === "explore";
  const tuneOnly = form.mode === "tune";
  return useMemo(() => {
    if (form.strategyId == null || !form.ticker || searchSpace.issue != null || !searchSpace.preview) {
      return null;
    }
    if (evolving && (ruleLibrary.issue != null || !ruleLibrary.evolution)) {
      return null;
    }
    if (scoringIssue(form.scoring) != null) {
      return null;
    }
    const startMs = dayStartMs(form.startDate);
    const endMs = dayEndMs(form.endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return null;
    }
    const scoring = buildScoringConfig(form.scoring);
    return {
      strategy_id: form.strategyId,
      tickers: [form.ticker],
      timeframe: form.timeframe,
      start_ms: startMs,
      end_ms: endMs,
      method: form.method,
      max_trials: form.maxTrials,
      max_runtime_ms: Math.round(form.maxRuntimeMinutes * 60_000),
      folds: { foldCount: form.foldCount, mode: "anchored" as const },
      ...(form.holdoutPct > 0 ? { holdout: { fraction: form.holdoutPct / 100 } } : {}),
      seed: form.seed,
      ...(scoring ? { scoring } : {}),
      ...(!tuneOnly && searchSpace.ruleRoles ? { rule_roles: searchSpace.ruleRoles } : {}),
      ...(!tuneOnly && searchSpace.structureSearch
        ? { structure_search: searchSpace.structureSearch }
        : {}),
      ...(searchSpace.parameterOverrides
        ? { parameter_overrides: searchSpace.parameterOverrides }
        : {}),
      ...(evolving && ruleLibrary.evolution ? { evolution: ruleLibrary.evolution } : {}),
    };
  }, [
    form.strategyId,
    form.ticker,
    form.timeframe,
    form.startDate,
    form.endDate,
    form.method,
    form.maxTrials,
    form.maxRuntimeMinutes,
    form.foldCount,
    form.holdoutPct,
    form.seed,
    form.scoring,
    searchSpace.issue,
    searchSpace.preview,
    searchSpace.ruleRoles,
    searchSpace.structureSearch,
    searchSpace.parameterOverrides,
    evolving,
    tuneOnly,
    ruleLibrary.issue,
    ruleLibrary.evolution,
  ]);
}
