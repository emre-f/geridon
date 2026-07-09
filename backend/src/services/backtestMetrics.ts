import type {
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestTrade,
  Candle,
} from "../types.ts";

const msPerYear = 365.25 * 24 * 60 * 60 * 1000;

export interface MetricsInput {
  initialCapital: number;
  finalEquity: number;
  realizedPnl: number;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  candles: Candle[];
}

function annualizedReturnPct(
  initialCapital: number,
  finalEquity: number,
  candles: Candle[],
): number | null {
  if (candles.length < 2) {
    return null;
  }
  const years = (candles.at(-1)!.timestamp_ms - candles[0].timestamp_ms) / msPerYear;
  if (years <= 0) {
    return null;
  }
  if (finalEquity <= 0) {
    return -100;
  }
  return ((finalEquity / initialCapital) ** (1 / years) - 1) * 100;
}

function maxDrawdownPct(equityCurve: BacktestEquityPoint[]): number {
  let peak = equityCurve[0]?.equity ?? 0;
  let worst = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    if (peak > 0) {
      worst = Math.min(worst, ((point.equity - peak) / peak) * 100);
    }
  }
  return worst;
}

function periodsPerYear(candles: Candle[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].timestamp_ms - candles[i - 1].timestamp_ms;
    if (delta > 0) {
      deltas.push(delta);
    }
  }
  if (deltas.length === 0) {
    return null;
  }
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? msPerYear / median : null;
}

function sharpeRatio(equityCurve: BacktestEquityPoint[], candles: Candle[]): number | null {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const previous = equityCurve[i - 1].equity;
    if (previous > 0) {
      returns.push(equityCurve[i].equity / previous - 1);
    }
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  const perYear = periodsPerYear(candles);
  if (std === 0 || perYear == null) {
    return null;
  }
  return (mean / std) * Math.sqrt(perYear);
}

export function computeMetrics(input: MetricsInput): BacktestMetrics {
  const { initialCapital, finalEquity, realizedPnl, trades, equityCurve, candles } = input;

  const sellCount = trades.filter((trade) => trade.side === "sell").length;
  const closingTrades = trades.filter((trade) => trade.realized_pnl != null);
  const wins = closingTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0);

  let grossProfit = 0;
  let grossLoss = 0;
  for (const trade of closingTrades) {
    const pnl = trade.realized_pnl ?? 0;
    if (pnl > 0) {
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += -pnl;
    }
  }

  const avgTradePnl =
    closingTrades.length > 0
      ? closingTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0) /
        closingTrades.length
      : null;

  return {
    initial_capital: initialCapital,
    final_equity: finalEquity,
    total_return_pct: (finalEquity / initialCapital - 1) * 100,
    annualized_return_pct: annualizedReturnPct(initialCapital, finalEquity, candles),
    trade_count: trades.length,
    buy_count: trades.length - sellCount,
    sell_count: sellCount,
    win_rate_pct:
      closingTrades.length > 0 ? (wins.length / closingTrades.length) * 100 : null,
    max_drawdown_pct: maxDrawdownPct(equityCurve),
    avg_trade_pnl: avgTradePnl,
    profit_factor:
      closingTrades.length === 0 || grossLoss === 0 ? null : grossProfit / grossLoss,
    sharpe_ratio: sharpeRatio(equityCurve, candles),
    realized_pnl: realizedPnl,
    candle_count: candles.length,
    first_candle_ms: candles.at(0)?.timestamp_ms ?? null,
    last_candle_ms: candles.at(-1)?.timestamp_ms ?? null,
  };
}
