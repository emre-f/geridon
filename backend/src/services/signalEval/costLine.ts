import type { TradeCosts } from "../../types/backtests.ts";
import { validateTradeCosts } from "../backtest.ts";
import type { HorizonSummary } from "./horizonSummary.ts";

export const defaultNotionalPerEvent = 10_000;

export interface CostLineOptions {
  costs: TradeCosts;
  /** Dollar size assumed per event; only used to express the fixed commission as a return. */
  notionalPerEvent?: number;
}

export interface CostLineRow {
  horizon: number;
  abnormal: number | null;
  net_abnormal: number | null;
}

export interface CostLine {
  round_trip_cost: number;
  rows: CostLineRow[];
  headline_horizon: number | null;
  gross_abnormal_return: number | null;
  net_abnormal_return: number | null;
}

export function roundTripCost(
  costs: TradeCosts,
  notionalPerEvent: number = defaultNotionalPerEvent,
): number {
  const costsError = validateTradeCosts(costs);
  if (costsError) {
    throw new Error(costsError);
  }
  if (!Number.isFinite(notionalPerEvent) || notionalPerEvent <= 0) {
    throw new Error("notionalPerEvent must be a positive number.");
  }
  const perSide =
    costs.slippage_bps / 10_000 +
    costs.commission_pct / 100 +
    costs.commission_per_trade / notionalPerEvent;
  return 2 * perSide;
}

/**
 * The headline number: abnormal return per event net of a full round trip of
 * costs (entry + exit). Taken at the natural holding period when the signal
 * has one; otherwise at the longest horizon with data, so a losing signal
 * still gets a (negative) net number instead of a null.
 */
export function computeCostLine(summary: HorizonSummary, options: CostLineOptions): CostLine {
  const cost = roundTripCost(options.costs, options.notionalPerEvent);
  const rows = summary.rows.map((row) => ({
    horizon: row.horizon,
    abnormal: row.abnormal,
    net_abnormal: row.abnormal == null ? null : row.abnormal - cost,
  }));

  let headlineHorizon: number | null = null;
  let gross: number | null = null;
  if (summary.natural_holding_period_bars != null) {
    headlineHorizon = summary.natural_holding_period_bars;
    gross = summary.peak_gap;
  } else {
    for (const row of rows) {
      if (row.abnormal != null) {
        headlineHorizon = row.horizon;
        gross = row.abnormal;
      }
    }
  }

  return {
    round_trip_cost: cost,
    rows,
    headline_horizon: headlineHorizon,
    gross_abnormal_return: gross,
    net_abnormal_return: gross == null ? null : gross - cost,
  };
}
