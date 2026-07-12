import type {
  OptimizationExperimentRecord,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";

const minFoldCandles = 60;
const minTotalTrades = 10;

/**
 * Research-hygiene warnings for a finished experiment: an opened sealed
 * holdout, zero costs, thin data, too few trades, and fold-to-fold
 * instability of the top candidate.
 */
export function experimentWarnings(
  record: OptimizationExperimentRecord,
  bestTrial: OptimizationTrialRecord | null,
): string[] {
  const warnings: string[] = [];

  if (record.holdout != null) {
    warnings.push(
      `The sealed holdout was opened for trial ${record.holdout.trial_index} — it is no longer unseen data, so it cannot vet any other candidate from this experiment.`,
    );
  }

  const costs = record.config.costs;
  if (
    costs != null &&
    costs.commission_per_trade === 0 &&
    costs.commission_pct === 0 &&
    costs.slippage_bps === 0
  ) {
    warnings.push(
      "Transaction costs are zero — every score ignores commissions and slippage, which flatters high-turnover candidates.",
    );
  }

  const foldCandles = (record.summary?.baseline.foldResults ?? []).map(
    (fold) => fold.candle_count,
  );
  if (foldCandles.length > 0) {
    const shortest = Math.min(...foldCandles);
    if (shortest < minFoldCandles) {
      warnings.push(
        `Small sample: the shortest validation fold covers only ${shortest} candles, so per-fold evidence is weak.`,
      );
    }
  }

  const metrics = bestTrial?.metrics ?? null;
  if (metrics != null && metrics.total_trades < minTotalTrades) {
    warnings.push(
      `The top candidate traded only ${metrics.total_trades} time${metrics.total_trades === 1 ? "" : "s"} across all validation folds — too few trades to trust the score.`,
    );
  }

  const score = bestTrial?.score ?? null;
  const unstablePenalty =
    score != null &&
    score.penalties.instability > 0 &&
    score.penalties.instability > 0.5 * Math.abs(score.medianObjective);
  const losesWorstFold =
    metrics != null && metrics.median_return_pct > 0 && metrics.worst_fold_return_pct < 0;
  if (unstablePenalty || losesWorstFold) {
    warnings.push(
      "The top candidate's results are unstable across validation folds — it may only work in some market regimes.",
    );
  }

  return warnings;
}
