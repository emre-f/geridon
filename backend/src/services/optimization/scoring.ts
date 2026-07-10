import type {
  FoldEvaluation,
  ScoringConfig,
  StrategyComplexity,
  TrialScore,
} from "../../types.ts";

export const scoringVersion = "1";

export const defaultScoringConfig: ScoringConfig = {
  objective: "sharpe",
  penalties: { drawdown: 0.02, instability: 0.5, turnover: 0.02, complexity: 0.05 },
  constraints: { minTotalTrades: 5, maxDrawdownPct: 60, minPositiveFoldFraction: 0.5 },
};

export function resolveScoringConfig(partial?: Partial<ScoringConfig>): ScoringConfig {
  return {
    objective: partial?.objective ?? defaultScoringConfig.objective,
    penalties: { ...defaultScoringConfig.penalties, ...partial?.penalties },
    constraints: { ...defaultScoringConfig.constraints, ...partial?.constraints },
  };
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function interquartileRange(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number) => {
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return quantile(0.75) - quantile(0.25);
}

export function scoreTrial(
  foldResults: FoldEvaluation[],
  complexity: StrategyComplexity,
  config: ScoringConfig,
): TrialScore {
  const foldObjectives = foldResults.map((fold) => fold.objectiveValue ?? 0);
  const medianObjective = median(foldObjectives);

  const drawdownPenalty =
    config.penalties.drawdown * median(foldResults.map((fold) => Math.abs(fold.max_drawdown_pct)));
  const instabilityPenalty = config.penalties.instability * interquartileRange(foldObjectives);
  const turnoverPenalty =
    config.penalties.turnover *
    median(
      foldResults.map((fold) =>
        fold.candle_count > 0 ? (fold.trade_count / fold.candle_count) * 100 : 0,
      ),
    );
  const complexityUnits =
    complexity.activeRules + complexity.uniqueIndicators + Math.max(0, complexity.maxDepth - 1);
  const complexityPenalty = config.penalties.complexity * complexityUnits;

  const totalTrades = foldResults.reduce((sum, fold) => sum + fold.trade_count, 0);
  const worstDrawdown = Math.max(
    0,
    ...foldResults.map((fold) => Math.abs(fold.max_drawdown_pct)),
  );
  const positiveFolds = foldResults.filter((fold) => (fold.objectiveValue ?? 0) > 0).length;
  const positiveFraction = foldResults.length > 0 ? positiveFolds / foldResults.length : 0;

  const ineligibilityReasons: string[] = [];
  if (totalTrades < config.constraints.minTotalTrades) {
    ineligibilityReasons.push(
      `only ${totalTrades} trades across folds (minimum ${config.constraints.minTotalTrades})`,
    );
  }
  if (worstDrawdown > config.constraints.maxDrawdownPct) {
    ineligibilityReasons.push(
      `worst fold drawdown ${worstDrawdown.toFixed(1)}% exceeds ${config.constraints.maxDrawdownPct}%`,
    );
  }
  if (positiveFraction < config.constraints.minPositiveFoldFraction) {
    ineligibilityReasons.push(
      `positive objective in ${(positiveFraction * 100).toFixed(0)}% of folds ` +
        `(minimum ${(config.constraints.minPositiveFoldFraction * 100).toFixed(0)}%)`,
    );
  }

  return {
    score:
      medianObjective -
      drawdownPenalty -
      instabilityPenalty -
      turnoverPenalty -
      complexityPenalty,
    medianObjective,
    eligible: ineligibilityReasons.length === 0,
    ineligibilityReasons,
    penalties: {
      drawdown: drawdownPenalty,
      instability: instabilityPenalty,
      turnover: turnoverPenalty,
      complexity: complexityPenalty,
    },
  };
}

export function compareTrialScores(left: TrialScore | null, right: TrialScore | null): number {
  if (left == null || right == null) {
    return left == null && right == null ? 0 : left == null ? 1 : -1;
  }
  if (left.eligible !== right.eligible) {
    return left.eligible ? -1 : 1;
  }
  return right.score - left.score;
}
