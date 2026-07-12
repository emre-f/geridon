import { collectRules, describeRule, pathId } from "./strategyPaths.ts";
import type { OptimizationTrial, RuleInclusionEntry, Strategy } from "../../types.ts";

export const defaultInclusionTopCount = 10;

/**
 * Counts how often each rule is active among the top eligible candidates.
 * A rule that shows up in only one lucky candidate is weak evidence, so the
 * result reports counts against the number of candidates inspected. Summaries
 * come from the baseline snapshot when the rule exists there, so tuned
 * parameter values in individual candidates do not fragment the label.
 */
export function computeRuleInclusion(
  leaderboard: OptimizationTrial[],
  baseline: Strategy,
  topCount = defaultInclusionTopCount,
): RuleInclusionEntry[] {
  const top = leaderboard
    .filter((trial) => trial.score?.eligible)
    .slice(0, topCount);
  if (top.length === 0) {
    return [];
  }

  const baselineSummaries = new Map<string, string>();
  for (const { path, rule } of collectRules(baseline)) {
    baselineSummaries.set(pathId(path), `${path[0]}: ${describeRule(rule)}`);
  }

  const entries = new Map<string, { summary: string; includedCount: number }>();
  for (const trial of top) {
    for (const { path, rule } of collectRules(trial.strategy)) {
      const ruleId = pathId(path);
      let entry = entries.get(ruleId);
      if (!entry) {
        entry = {
          summary: baselineSummaries.get(ruleId) ?? `${path[0]}: ${describeRule(rule)}`,
          includedCount: 0,
        };
        entries.set(ruleId, entry);
      }
      if (rule.enabled !== false) {
        entry.includedCount += 1;
      }
    }
  }

  return [...entries.entries()]
    .map(([ruleId, entry]) => ({
      ruleId,
      summary: entry.summary,
      includedCount: entry.includedCount,
      topCount: top.length,
    }))
    .sort(
      (left, right) =>
        right.includedCount - left.includedCount || left.ruleId.localeCompare(right.ruleId),
    );
}
