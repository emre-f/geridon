import { evaluateSignals } from "./signals.ts";
import type {
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestPositionMode,
  BacktestResult,
  BacktestTrade,
  Candle,
  Strategy,
} from "../types.ts";

export interface BacktestOptions {
  strategy: Strategy;
  candles: Candle[];
  /**
   * long_only: buys spend buyPercent of equity (cash-capped) and sells
   * liquidate sellPercent of the position.
   * always_in: stop-and-reverse — sizing percents are ignored and every fill
   * flips the account to 100% long or a cash-secured 100% short.
   */
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
}

// Ignore float dust so a 100% sell really flattens the position and a
// cash-exhausted account stops producing microscopic buys.
const shareEpsilon = 1e-9;
const minimumTradeValue = 0.01;

function validatePercent(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(`${label} must be greater than 0 and at most 100.`);
  }
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const { strategy, candles, positionMode, buyPercent, sellPercent, initialCapital } = options;
  validatePercent(buyPercent, "buy_percent");
  validatePercent(sellPercent, "sell_percent");
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error("initial_capital must be a positive number.");
  }

  const signalsByTimestamp = new Map<number, { buy: boolean; sell: boolean }>();
  for (const signal of evaluateSignals(strategy, candles)) {
    const entry = signalsByTimestamp.get(signal.timestamp_ms) ?? { buy: false, sell: false };
    entry[signal.side] = true;
    signalsByTimestamp.set(signal.timestamp_ms, entry);
  }

  let cash = initialCapital;
  // Negative shares represent a short position in always_in mode.
  let shares = 0;
  let averageCost = 0;
  let realizedPnl = 0;
  // Signals fire on a bar's close and fill on the next bar's open, so the
  // simulation never trades on information the bar has not produced yet.
  let pendingOrder: "buy" | "sell" | null = null;

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  function recordTrade(
    side: "buy" | "sell",
    timestampMs: number,
    price: number,
    tradedShares: number,
    tradePnl: number | null,
  ) {
    trades.push({
      timestamp_ms: timestampMs,
      side,
      price,
      shares: tradedShares,
      value: tradedShares * price,
      cash_after: cash,
      shares_after: shares,
      equity_after: cash + shares * price,
      realized_pnl: tradePnl,
    });
  }

  function fillLongOnlyBuy(candle: Candle) {
    const price = candle.open;
    const equity = cash + shares * price;
    const spend = Math.min(cash, (buyPercent / 100) * equity);
    if (price <= 0 || spend < minimumTradeValue) {
      return;
    }
    const boughtShares = spend / price;
    averageCost = (averageCost * shares + spend) / (shares + boughtShares);
    shares += boughtShares;
    cash -= spend;
    recordTrade("buy", candle.timestamp_ms, price, boughtShares, null);
  }

  function fillLongOnlySell(candle: Candle) {
    const price = candle.open;
    if (shares <= shareEpsilon || price <= 0) {
      return;
    }
    const soldShares = (sellPercent / 100) * shares;
    const tradePnl = (price - averageCost) * soldShares;
    shares -= soldShares;
    if (shares <= shareEpsilon) {
      shares = 0;
      averageCost = 0;
    }
    cash += soldShares * price;
    realizedPnl += tradePnl;
    recordTrade("sell", candle.timestamp_ms, price, soldShares, tradePnl);
  }

  // Flip to 100% long: cover any short at the open, then spend all cash.
  function fillAlwaysInBuy(candle: Candle) {
    const price = candle.open;
    if (price <= 0) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    if (shares < -shareEpsilon) {
      const coveredShares = -shares;
      tradePnl = (averageCost - price) * coveredShares;
      realizedPnl += tradePnl;
      cash -= coveredShares * price;
      tradedShares += coveredShares;
      shares = 0;
    }
    // A short that moved against the account past its equity leaves negative
    // cash; the account is bust and stays flat.
    if (cash >= minimumTradeValue) {
      const boughtShares = cash / price;
      shares = boughtShares;
      averageCost = price;
      tradedShares += boughtShares;
      cash = 0;
    }
    if (tradedShares > shareEpsilon) {
      recordTrade("buy", candle.timestamp_ms, price, tradedShares, tradePnl);
    }
  }

  // Flip to 100% short: close any long at the open, then short the account's
  // full equity (cash-secured — proceeds sit as collateral, no leverage).
  function fillAlwaysInSell(candle: Candle) {
    const price = candle.open;
    if (price <= 0 || shares < -shareEpsilon) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    if (shares > shareEpsilon) {
      tradePnl = (price - averageCost) * shares;
      realizedPnl += tradePnl;
      cash += shares * price;
      tradedShares += shares;
      shares = 0;
    }
    if (cash >= minimumTradeValue) {
      const shortedShares = cash / price;
      shares = -shortedShares;
      averageCost = price;
      tradedShares += shortedShares;
      cash += shortedShares * price;
    }
    if (tradedShares > shareEpsilon) {
      recordTrade("sell", candle.timestamp_ms, price, tradedShares, tradePnl);
    }
  }

  for (const candle of candles) {
    if (pendingOrder === "buy") {
      if (positionMode === "always_in") {
        fillAlwaysInBuy(candle);
      } else {
        fillLongOnlyBuy(candle);
      }
    } else if (pendingOrder === "sell") {
      if (positionMode === "always_in") {
        fillAlwaysInSell(candle);
      } else {
        fillLongOnlySell(candle);
      }
    }
    pendingOrder = null;

    const signal = signalsByTimestamp.get(candle.timestamp_ms);
    if (positionMode === "always_in") {
      // Only queue fills that change the position: sells while flat/long,
      // buys while flat/short. Sell wins a simultaneous signal, matching the
      // long-only exit priority.
      if (signal?.sell && shares > -shareEpsilon) {
        pendingOrder = "sell";
      } else if (signal?.buy && shares < shareEpsilon) {
        pendingOrder = "buy";
      }
    } else if (signal?.sell && shares > shareEpsilon) {
      pendingOrder = "sell";
    } else if (signal?.buy) {
      pendingOrder = "buy";
    }

    const positionValue = shares * candle.close;
    equityCurve.push({
      timestamp_ms: candle.timestamp_ms,
      equity: cash + positionValue,
      cash,
      shares,
      position_value: positionValue,
    });
  }

  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const sellCount = trades.filter((trade) => trade.side === "sell").length;
  const closingTrades = trades.filter((trade) => trade.realized_pnl != null);
  const wins = closingTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0);
  const metrics: BacktestMetrics = {
    initial_capital: initialCapital,
    final_equity: finalEquity,
    total_return_pct: (finalEquity / initialCapital - 1) * 100,
    trade_count: trades.length,
    buy_count: trades.length - sellCount,
    sell_count: sellCount,
    win_rate_pct:
      closingTrades.length > 0 ? (wins.length / closingTrades.length) * 100 : null,
    realized_pnl: realizedPnl,
    candle_count: candles.length,
    first_candle_ms: candles.at(0)?.timestamp_ms ?? null,
    last_candle_ms: candles.at(-1)?.timestamp_ms ?? null,
  };

  return { metrics, equity_curve: equityCurve, trades };
}
