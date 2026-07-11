import { computeMetrics } from "./backtestMetrics.ts";
import { evaluateSignals } from "./signals.ts";
import { BacktestAccount, positionEpsilon, zeroTradeCosts } from "./backtestAccount.ts";
import type {
  BacktestEquityPoint,
  BacktestPositionMode,
  BacktestResult,
  Candle,
  Strategy,
  TradeCosts,
} from "../types.ts";

export { zeroTradeCosts };

export const tradeCostLimits = {
  maxCommissionPerTrade: 1_000,
  maxCommissionPct: 10,
  maxSlippageBps: 1_000,
};

export function validateTradeCosts(costs: TradeCosts): string | null {
  const fields: Array<[keyof TradeCosts, string, number]> = [
    ["commission_per_trade", "costs.commission_per_trade", tradeCostLimits.maxCommissionPerTrade],
    ["commission_pct", "costs.commission_pct", tradeCostLimits.maxCommissionPct],
    ["slippage_bps", "costs.slippage_bps", tradeCostLimits.maxSlippageBps],
  ];
  for (const [key, label, max] of fields) {
    const value = costs[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
      return `${label} must be a number between 0 and ${max}.`;
    }
  }
  return null;
}

export interface BacktestOptions {
  strategy: Strategy;
  candles: Candle[];
  /**
   * long_only: buys spend buyPercent of equity (cash-capped) and sells
   * liquidate sellPercent of the position.
   * always_in: stop-and-reverse — sizing percents are ignored and every fill
   * flips the account to 100% long or a cash-secured 100% short.
   * three_state: long / short / cash targets from the strategy's entry
   * (long), exit (short) and cash trees; percents are ignored.
   */
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  /** Commission/slippage assumptions; omitted means frictionless fills. */
  costs?: TradeCosts;
  /**
   * First candle index where trading may happen; earlier candles only warm
   * indicators and are excluded from the equity curve and metrics.
   */
  simulationStartIndex?: number;
}

type ThreeStateTarget = "long" | "short" | "cash";

function validatePercent(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(`${label} must be greater than 0 and at most 100.`);
  }
}

function positionState(shares: number): ThreeStateTarget {
  if (shares > positionEpsilon) {
    return "long";
  }
  if (shares < -positionEpsilon) {
    return "short";
  }
  return "cash";
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const { strategy, candles, positionMode, buyPercent, sellPercent, initialCapital } = options;
  validatePercent(buyPercent, "buy_percent");
  validatePercent(sellPercent, "sell_percent");
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error("initial_capital must be a positive number.");
  }
  const startIndex = options.simulationStartIndex ?? 0;
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error("simulation_start_index must be a non-negative integer.");
  }
  const costs = options.costs ?? zeroTradeCosts;
  const costsError = validateTradeCosts(costs);
  if (costsError) {
    throw new Error(costsError);
  }

  const signalsByTimestamp = new Map<number, { buy: boolean; sell: boolean; cash: boolean }>();
  for (const signal of evaluateSignals(strategy, candles)) {
    const entry = signalsByTimestamp.get(signal.timestamp_ms) ?? {
      buy: false,
      sell: false,
      cash: false,
    };
    entry[signal.side] = true;
    signalsByTimestamp.set(signal.timestamp_ms, entry);
  }

  const account = new BacktestAccount(initialCapital, buyPercent, sellPercent, costs);
  const equityCurve: BacktestEquityPoint[] = [];

  // Signals fire on a bar's close and fill on the next bar's open, so the
  // simulation never trades on information the bar has not produced yet.
  let pendingOrder: "buy" | "sell" | null = null;
  let pendingTarget: ThreeStateTarget | null = null;

  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (positionMode === "three_state") {
      if (pendingTarget === "long") {
        account.alwaysInBuy(candle);
      } else if (pendingTarget === "short") {
        account.alwaysInSell(candle);
      } else if (pendingTarget === "cash") {
        account.flatten(candle);
      }
      pendingTarget = null;
    } else if (pendingOrder === "buy") {
      positionMode === "always_in" ? account.alwaysInBuy(candle) : account.longOnlyBuy(candle);
      pendingOrder = null;
    } else if (pendingOrder === "sell") {
      positionMode === "always_in" ? account.alwaysInSell(candle) : account.longOnlySell(candle);
      pendingOrder = null;
    }

    const signal = signalsByTimestamp.get(candle.timestamp_ms);
    if (positionMode === "three_state") {
      // Precedence LONG > SHORT > CASH; no matching tree keeps the position.
      const current = positionState(account.shares);
      let desired = current;
      if (signal?.buy) {
        desired = "long";
      } else if (signal?.sell) {
        desired = "short";
      } else if (signal?.cash) {
        desired = "cash";
      }
      pendingTarget = desired === current ? null : desired;
    } else if (positionMode === "always_in") {
      // Only queue fills that change the position: sells while flat/long,
      // buys while flat/short. Sell wins a simultaneous signal, matching the
      // long-only exit priority.
      if (signal?.sell && account.shares > -positionEpsilon) {
        pendingOrder = "sell";
      } else if (signal?.buy && account.shares < positionEpsilon) {
        pendingOrder = "buy";
      }
    } else if (signal?.sell && account.shares > positionEpsilon) {
      pendingOrder = "sell";
    } else if (signal?.buy) {
      pendingOrder = "buy";
    }

    const positionValue = account.shares * candle.close;
    equityCurve.push({
      timestamp_ms: candle.timestamp_ms,
      equity: account.cash + positionValue,
      cash: account.cash,
      shares: account.shares,
      position_value: positionValue,
    });
  }

  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const metrics = computeMetrics({
    initialCapital,
    finalEquity,
    realizedPnl: account.realizedPnl,
    totalCommission: account.totalCommission,
    totalSlippageCost: account.totalSlippageCost,
    trades: account.trades,
    equityCurve,
    candles: startIndex > 0 ? candles.slice(startIndex) : candles,
  });

  return { metrics, equity_curve: equityCurve, trades: account.trades };
}
