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
  totalCommission?: number;
  totalSlippageCost?: number;
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

function barReturns(equityCurve: BacktestEquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const previous = equityCurve[i - 1].equity;
    if (previous > 0) {
      returns.push(equityCurve[i].equity / previous - 1);
    }
  }
  return returns;
}

function sharpeRatio(equityCurve: BacktestEquityPoint[], candles: Candle[]): number | null {
  const returns = barReturns(equityCurve);
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

// Like Sharpe, but only downside deviation from zero counts as risk.
function sortinoRatio(equityCurve: BacktestEquityPoint[], candles: Candle[]): number | null {
  const returns = barReturns(equityCurve);
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const downsideVariance =
    returns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / returns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);
  const perYear = periodsPerYear(candles);
  if (downsideDeviation === 0 || perYear == null) {
    return null;
  }
  return (mean / downsideDeviation) * Math.sqrt(perYear);
}

function calmarRatio(annualizedReturn: number | null, maxDrawdown: number): number | null {
  if (annualizedReturn == null || maxDrawdown === 0) {
    return null;
  }
  return annualizedReturn / Math.abs(maxDrawdown);
}

const exposureEpsilon = 1e-9;

function positionStats(equityCurve: BacktestEquityPoint[]) {
  let barsInMarket = 0;
  let entries = 0;
  let previousInMarket = false;
  for (const point of equityCurve) {
    const inMarket = Math.abs(point.shares) > exposureEpsilon;
    if (inMarket) {
      barsInMarket += 1;
      if (!previousInMarket) {
        entries += 1;
      }
    }
    previousInMarket = inMarket;
  }
  return {
    exposurePct: equityCurve.length > 0 ? (barsInMarket / equityCurve.length) * 100 : 0,
    avgHoldingPeriod: entries > 0 ? barsInMarket / entries : null,
  };
}

function turnoverRatio(trades: BacktestTrade[], equityCurve: BacktestEquityPoint[]): number | null {
  if (equityCurve.length === 0) {
    return null;
  }
  const meanEquity =
    equityCurve.reduce((sum, point) => sum + point.equity, 0) / equityCurve.length;
  if (meanEquity <= 0) {
    return null;
  }
  const tradedValue = trades.reduce((sum, trade) => sum + Math.abs(trade.value), 0);
  return tradedValue / meanEquity;
}

export function computeMetrics(input: MetricsInput): BacktestMetrics {
  const { initialCapital, finalEquity, realizedPnl, trades, equityCurve, candles } = input;
  const annualizedReturn = annualizedReturnPct(initialCapital, finalEquity, candles);
  const maxDrawdown = maxDrawdownPct(equityCurve);
  const { exposurePct, avgHoldingPeriod } = positionStats(equityCurve);

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
    annualized_return_pct: annualizedReturn,
    trade_count: trades.length,
    buy_count: trades.length - sellCount,
    sell_count: sellCount,
    win_rate_pct:
      closingTrades.length > 0 ? (wins.length / closingTrades.length) * 100 : null,
    max_drawdown_pct: maxDrawdown,
    avg_trade_pnl: avgTradePnl,
    profit_factor:
      closingTrades.length === 0 || grossLoss === 0 ? null : grossProfit / grossLoss,
    sharpe_ratio: sharpeRatio(equityCurve, candles),
    sortino_ratio: sortinoRatio(equityCurve, candles),
    calmar_ratio: calmarRatio(annualizedReturn, maxDrawdown),
    exposure_pct: exposurePct,
    turnover_ratio: turnoverRatio(trades, equityCurve),
    avg_holding_period_candles: avgHoldingPeriod,
    total_commission: input.totalCommission ?? 0,
    total_slippage_cost: input.totalSlippageCost ?? 0,
    realized_pnl: realizedPnl,
    candle_count: candles.length,
    first_candle_ms: candles.at(0)?.timestamp_ms ?? null,
    last_candle_ms: candles.at(-1)?.timestamp_ms ?? null,
  };
}
