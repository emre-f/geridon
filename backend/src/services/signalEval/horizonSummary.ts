import { forwardReturnHorizons } from "../forwardReturns.ts";
import type { EventStudyResult } from "./eventStudy.ts";

export interface HorizonSummaryRow {
  horizon: number;
  signal_mean: number | null;
  baseline_mean: number | null;
  abnormal: number | null;
}

export interface HorizonSummary {
  rows: HorizonSummaryRow[];
  natural_holding_period_bars: number | null;
  peak_gap: number | null;
}

/**
 * The natural holding period is where the gap versus baseline stops growing:
 * the first horizon at which the mean cumulative gap reaches its maximum,
 * taken over the full per-bar curve, not just the reported horizons. A signal
 * whose gap never goes positive has no holding period.
 */
export function summarizeHorizons(
  study: EventStudyResult,
  horizons: readonly number[] = forwardReturnHorizons,
): HorizonSummary {
  const pointsByHorizon = new Map(study.curve.map((point) => [point.horizon, point]));
  const rows = horizons.map((horizon) => {
    const point = pointsByHorizon.get(horizon);
    return {
      horizon,
      signal_mean: point?.signal_mean ?? null,
      baseline_mean: point?.baseline_mean ?? null,
      abnormal: point?.gap ?? null,
    };
  });

  let peakHorizon: number | null = null;
  let peakGap: number | null = null;
  for (const point of study.curve) {
    if (point.gap != null && (peakGap == null || point.gap > peakGap)) {
      peakGap = point.gap;
      peakHorizon = point.horizon;
    }
  }

  return {
    rows,
    natural_holding_period_bars: peakGap != null && peakGap > 0 ? peakHorizon : null,
    peak_gap: peakGap,
  };
}
