import type { StrategySnapshot } from "@/lib/api-strategy-types";

export type BacktestPositionMode = "long_only" | "always_in";

export interface BacktestTrade {
  timestamp_ms: number;
  side: "buy" | "sell";
  price: number;
  shares: number;
  value: number;
  cash_after: number;
  shares_after: number;
  equity_after: number;
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
  annualized_return_pct: number | null;
  trade_count: number;
  buy_count: number;
  sell_count: number;
  win_rate_pct: number | null;
  max_drawdown_pct: number;
  avg_trade_pnl: number | null;
  profit_factor: number | null;
  sharpe_ratio: number | null;
  realized_pnl: number;
  candle_count: number;
  first_candle_ms: number | null;
  last_candle_ms: number | null;
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
  metrics: BacktestMetrics;
  /** True when the strategy's entry/exit rules were edited after this run. */
  strategy_outdated: boolean;
  created_at: string;
}

export interface BacktestRunRecord extends BacktestRunSummary {
  strategy_snapshot: StrategySnapshot;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}
