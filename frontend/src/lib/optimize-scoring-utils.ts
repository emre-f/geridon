import type { OptimizationObjective, ScoringConfig } from "@/lib/api";

/** Mirrors the backend's defaultScoringConfig; only deviations are sent. */
export const defaultScoring: ScoringConfig = {
  objective: "sharpe",
  penalties: { drawdown: 0.02, instability: 0.25, turnover: 0.02, complexity: 0.05 },
  constraints: { minTotalTrades: 5, maxDrawdownPct: 60, minPositiveFoldFraction: 0.5 },
};

export const objectiveLabels: Record<OptimizationObjective, string> = {
  sharpe: "Sharpe ratio",
  annualized_return: "Annualized return",
  total_return: "Total return",
};

const maxPenaltyWeight = 10;

function sameRecord<T extends object>(left: T, right: T): boolean {
  return (Object.keys(left) as Array<keyof T>).every((key) => left[key] === right[key]);
}

/** The scoring payload for the experiment request; undefined when everything
 * matches the backend defaults. Deviating sections are sent whole. */
export function buildScoringConfig(edit: ScoringConfig): Partial<ScoringConfig> | undefined {
  const scoring: Partial<ScoringConfig> = {};
  if (edit.objective !== defaultScoring.objective) {
    scoring.objective = edit.objective;
  }
  if (!sameRecord(edit.penalties, defaultScoring.penalties)) {
    scoring.penalties = { ...edit.penalties };
  }
  if (!sameRecord(edit.constraints, defaultScoring.constraints)) {
    scoring.constraints = { ...edit.constraints };
  }
  return Object.keys(scoring).length > 0 ? scoring : undefined;
}

/** Pre-validation matching the backend's scoring bounds. */
export function scoringIssue(edit: ScoringConfig): string | null {
  for (const [key, value] of Object.entries(edit.penalties)) {
    if (!Number.isFinite(value) || value < 0 || value > maxPenaltyWeight) {
      return `The ${key} penalty must be between 0 and ${maxPenaltyWeight}.`;
    }
  }
  const { minTotalTrades, maxDrawdownPct, minPositiveFoldFraction } = edit.constraints;
  if (!Number.isInteger(minTotalTrades) || minTotalTrades < 0) {
    return "Minimum trades must be a whole number of at least 0.";
  }
  if (!Number.isFinite(maxDrawdownPct) || maxDrawdownPct <= 0 || maxDrawdownPct > 100) {
    return "Maximum drawdown must be between 0 and 100 percent.";
  }
  if (
    !Number.isFinite(minPositiveFoldFraction) ||
    minPositiveFoldFraction < 0 ||
    minPositiveFoldFraction > 1
  ) {
    return "Minimum positive folds must be between 0 and 100 percent.";
  }
  return null;
}

export function scoringSummary(edit: ScoringConfig): string {
  const parts = [objectiveLabels[edit.objective]];
  parts.push(
    sameRecord(edit.penalties, defaultScoring.penalties)
      ? "default penalties"
      : "custom penalties",
  );
  parts.push(
    sameRecord(edit.constraints, defaultScoring.constraints)
      ? "default constraints"
      : "custom constraints",
  );
  return parts.join(" · ");
}
