import type { Strategy } from "./strategies.ts";

/**
 * long_only: sells reduce/close the position; sells while flat are ignored.
 * always_in: stop-and-reverse - every fill flips to 100% long or 100% short.
 * three_state: long / short / cash targets from the entry / exit / cash trees.
 */
export type BacktestPositionMode = "long_only" | "always_in" | "three_state";

/**
 * Per-fill trading frictions. Slippage moves every fill price against the
 * account (buys fill higher, sells lower); commission is deducted from cash.
 */
export interface TradeCosts {
  /** Fixed currency amount charged once per fill. */
  commission_per_trade: number;
  /** Percent of the fill's traded value charged as commission. */
  commission_pct: number;
  /** Adverse fill-price adjustment in basis points of the open. */
  slippage_bps: number;
}

export interface BacktestTrade {
  timestamp_ms: number;
  side: "buy" | "sell";
  /** Position the fill aimed for; only set by the account-flipping modes. */
  target?: "long" | "short" | "cash";
  price: number;
  shares: number;
  value: number;
  cash_after: number;
  shares_after: number;
  equity_after: number;
  /** Commission charged for this fill; 0 when the run has no costs. */
  commission: number;
  /** Realized profit vs. average cost; null for buys. */
  realized_pnl: number | null;
}

export interface BacktestEquityPoint {
  timestamp_ms: number;
  equity: number;
  cash: number;
  shares: number;
  position_value: number;
}

export interface BacktestMetrics {
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  /** Geometric return scaled to a year; null when the span is under a candle. */
  annualized_return_pct: number | null;
  trade_count: number;
  buy_count: number;
  sell_count: number;
  /** Share of sells realizing a profit; null before the first sell. */
  win_rate_pct: number | null;
  /** Deepest peak-to-trough equity decline as a non-positive percent. */
  max_drawdown_pct: number;
  /** Mean realized profit per closed trade; null before the first sell. */
  avg_trade_pnl: number | null;
  /** Gross profit over gross loss; null with no losing trades. */
  profit_factor: number | null;
  /** Annualized Sharpe of per-bar returns; null when returns don't vary. */
  sharpe_ratio: number | null;
  /** Sharpe against downside deviation only; null without negative returns. */
  sortino_ratio: number | null;
  /** Annualized return over worst drawdown; null while flat or undrawn. */
  calmar_ratio: number | null;
  /** Share of simulated bars holding a non-zero position. */
  exposure_pct: number;
  /** Total traded value over mean equity; null on an empty curve. */
  turnover_ratio: number | null;
  /** Mean bars from entering a position to going flat; null with no entries. */
  avg_holding_period_candles: number | null;
  total_commission: number;
  /** Sum of adverse fill-price adjustments paid to slippage. */
  total_slippage_cost: number;
  realized_pnl: number;
  candle_count: number;
  first_candle_ms: number | null;
  last_candle_ms: number | null;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}

export interface BacktestRunSummary {
  id: number;
  strategy_id: number;
  ticker: string;
  timeframe: string;
  start_ms: number;
  end_ms: number;
  position_mode: BacktestPositionMode;
  buy_percent: number;
  sell_percent: number;
  initial_capital: number;
  costs: TradeCosts;
  metrics: BacktestMetrics;
  /** True when the strategy's entry/exit rules were edited after this run. */
  strategy_outdated: boolean;
  created_at: string;
}

export interface BacktestRunRecord extends BacktestRunSummary {
  strategy_snapshot: Strategy;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}
