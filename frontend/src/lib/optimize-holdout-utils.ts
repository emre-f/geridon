import type {
  FoldEvaluation,
  HoldoutEvaluation,
  OptimizationExperimentRecord,
} from "@/lib/api-types";

export interface HoldoutWindowSummary {
  sealedCandles: number;
  totalCandles: number;
  fractionPct: number;
}

/** How much data the experiment sealed, summed across its symbols. */
export function holdoutWindowSummary(
  record: OptimizationExperimentRecord,
): HoldoutWindowSummary | null {
  const fraction = record.config.holdout?.fraction;
  if (fraction == null) {
    return null;
  }
  let sealedCandles = 0;
  let totalCandles = 0;
  for (const spec of record.snapshot.datasets) {
    sealedCandles += spec.holdout_candle_count ?? 0;
    totalCandles += spec.candle_count;
  }
  return { sealedCandles, totalCandles, fractionPct: Math.round(fraction * 100) };
}

export interface HoldoutComparisonRow {
  key: string;
  symbol: string;
  label: "Candidate" | "Baseline" | "Buy & hold";
  returnPct: number;
  drawdownPct: number;
  trades: number;
}

/** One row per strategy per symbol, candidate first so the comparison reads top-down. */
export function holdoutComparisonRows(evaluation: HoldoutEvaluation): HoldoutComparisonRow[] {
  const groups: Array<{ label: HoldoutComparisonRow["label"]; results: FoldEvaluation[] }> = [
    { label: "Candidate", results: evaluation.candidate },
    { label: "Baseline", results: evaluation.baseline },
    { label: "Buy & hold", results: evaluation.buy_hold },
  ];
  const symbols = [...new Set(evaluation.candidate.map((result) => result.symbol))];
  const rows: HoldoutComparisonRow[] = [];
  for (const symbol of symbols) {
    for (const group of groups) {
      const result = group.results.find((entry) => entry.symbol === symbol);
      if (result) {
        rows.push({
          key: `${symbol}:${group.label}`,
          symbol,
          label: group.label,
          returnPct: result.total_return_pct,
          drawdownPct: result.max_drawdown_pct,
          trades: result.trade_count,
        });
      }
    }
  }
  return rows;
}
