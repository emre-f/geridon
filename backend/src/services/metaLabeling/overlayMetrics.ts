import type { FoldEvaluation, OptimizationObjective } from "../../types.ts";

export interface AppliedTrade {
  size: number;
  return_pct: number;
  label: 0 | 1;
}

export interface ClassificationCounts {
  taken_winners: number;
  taken_losers: number;
  skipped_winners: number;
  skipped_losers: number;
}

export function classify(trades: AppliedTrade[]): ClassificationCounts {
  const counts: ClassificationCounts = {
    taken_winners: 0,
    taken_losers: 0,
    skipped_winners: 0,
    skipped_losers: 0,
  };
  for (const trade of trades) {
    const taken = trade.size > 0;
    if (taken && trade.label === 1) counts.taken_winners += 1;
    else if (taken) counts.taken_losers += 1;
    else if (trade.label === 1) counts.skipped_winners += 1;
    else counts.skipped_losers += 1;
  }
  return counts;
}

export function precision(counts: ClassificationCounts): number | null {
  const taken = counts.taken_winners + counts.taken_losers;
  return taken === 0 ? null : counts.taken_winners / taken;
}

export function recall(counts: ClassificationCounts): number | null {
  const winners = counts.taken_winners + counts.skipped_winners;
  return winners === 0 ? null : counts.taken_winners / winners;
}

function sampleSharpe(returns: number[]): number | null {
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std === 0 ? null : mean / std;
}

function maxDrawdownPct(equity: number[]): number {
  let peak = equity[0] ?? 1;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0;
    if (drawdown > worst) {
      worst = drawdown;
    }
  }
  return worst;
}

function objectiveValue(
  objective: OptimizationObjective,
  sharpe: number | null,
  totalReturnPct: number,
): number | null {
  if (objective === "sharpe") {
    return sharpe;
  }
  if (objective === "total_return") {
    return totalReturnPct;
  }
  return null;
}

export function foldEvaluationFromTrades(
  symbol: string,
  foldIndex: number,
  trades: AppliedTrade[],
  candleCount: number,
  objective: OptimizationObjective,
): FoldEvaluation {
  const taken = trades.filter((trade) => trade.size > 0);
  const returns = taken.map((trade) => (trade.size * trade.return_pct) / 100);

  const equity = [1];
  for (const value of returns) {
    equity.push(equity[equity.length - 1] * (1 + value));
  }
  const totalReturnPct = (equity[equity.length - 1] - 1) * 100;
  const sharpe = sampleSharpe(returns);

  return {
    symbol,
    foldIndex,
    objectiveValue: objectiveValue(objective, sharpe, totalReturnPct),
    total_return_pct: totalReturnPct,
    annualized_return_pct: null,
    sharpe_ratio: sharpe,
    max_drawdown_pct: maxDrawdownPct(equity),
    trade_count: taken.length,
    candle_count: candleCount,
  };
}
