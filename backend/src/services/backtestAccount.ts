import type { BacktestTrade, Candle } from "../types.ts";

// Ignore float dust so a 100% sell really flattens the position and a
// cash-exhausted account stops producing microscopic buys.
const shareEpsilon = 1e-9;
const minimumTradeValue = 0.01;

/**
 * Holds the running cash/position of a simulated account and applies fills at
 * a candle's open. Negative shares represent a short position.
 */
export class BacktestAccount {
  cash: number;
  // Negative shares represent a short position in always_in / three_state mode.
  shares = 0;
  private averageCost = 0;
  realizedPnl = 0;
  readonly trades: BacktestTrade[] = [];
  private readonly buyPercent: number;
  private readonly sellPercent: number;

  constructor(initialCapital: number, buyPercent: number, sellPercent: number) {
    this.cash = initialCapital;
    this.buyPercent = buyPercent;
    this.sellPercent = sellPercent;
  }

  private recordTrade(
    side: "buy" | "sell",
    timestampMs: number,
    price: number,
    tradedShares: number,
    tradePnl: number | null,
    target?: BacktestTrade["target"],
  ) {
    this.trades.push({
      timestamp_ms: timestampMs,
      side,
      ...(target ? { target } : {}),
      price,
      shares: tradedShares,
      value: tradedShares * price,
      cash_after: this.cash,
      shares_after: this.shares,
      equity_after: this.cash + this.shares * price,
      realized_pnl: tradePnl,
    });
  }

  private closeLong(price: number) {
    const tradedShares = this.shares;
    const tradePnl = (price - this.averageCost) * tradedShares;
    this.realizedPnl += tradePnl;
    this.cash += tradedShares * price;
    this.shares = 0;
    this.averageCost = 0;
    return { tradedShares, tradePnl };
  }

  private closeShort(price: number) {
    const tradedShares = -this.shares;
    const tradePnl = (this.averageCost - price) * tradedShares;
    this.realizedPnl += tradePnl;
    this.cash -= tradedShares * price;
    this.shares = 0;
    this.averageCost = 0;
    return { tradedShares, tradePnl };
  }

  longOnlyBuy(candle: Candle) {
    const price = candle.open;
    const equity = this.cash + this.shares * price;
    const spend = Math.min(this.cash, (this.buyPercent / 100) * equity);
    if (price <= 0 || spend < minimumTradeValue) {
      return;
    }
    const boughtShares = spend / price;
    this.averageCost = (this.averageCost * this.shares + spend) / (this.shares + boughtShares);
    this.shares += boughtShares;
    this.cash -= spend;
    this.recordTrade("buy", candle.timestamp_ms, price, boughtShares, null);
  }

  longOnlySell(candle: Candle) {
    const price = candle.open;
    if (this.shares <= shareEpsilon || price <= 0) {
      return;
    }
    const soldShares = (this.sellPercent / 100) * this.shares;
    const tradePnl = (price - this.averageCost) * soldShares;
    this.shares -= soldShares;
    if (this.shares <= shareEpsilon) {
      this.shares = 0;
      this.averageCost = 0;
    }
    this.cash += soldShares * price;
    this.realizedPnl += tradePnl;
    this.recordTrade("sell", candle.timestamp_ms, price, soldShares, tradePnl);
  }

  // Flip to 100% long: cover any short at the open, then spend all cash.
  alwaysInBuy(candle: Candle) {
    const price = candle.open;
    if (price <= 0) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    if (this.shares < -shareEpsilon) {
      const closed = this.closeShort(price);
      tradePnl = closed.tradePnl;
      tradedShares += closed.tradedShares;
    }
    // A short that moved against the account past its equity leaves negative
    // cash; the account is bust and stays flat.
    if (this.cash >= minimumTradeValue) {
      const boughtShares = this.cash / price;
      this.shares = boughtShares;
      this.averageCost = price;
      tradedShares += boughtShares;
      this.cash = 0;
    }
    if (tradedShares > shareEpsilon) {
      this.recordTrade("buy", candle.timestamp_ms, price, tradedShares, tradePnl, "long");
    }
  }

  // Flip to 100% short: close any long at the open, then short the account's
  // full equity (cash-secured — proceeds sit as collateral, no leverage).
  alwaysInSell(candle: Candle) {
    const price = candle.open;
    if (price <= 0 || this.shares < -shareEpsilon) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    if (this.shares > shareEpsilon) {
      const closed = this.closeLong(price);
      tradePnl = closed.tradePnl;
      tradedShares += closed.tradedShares;
    }
    if (this.cash >= minimumTradeValue) {
      const shortedShares = this.cash / price;
      this.shares = -shortedShares;
      this.averageCost = price;
      tradedShares += shortedShares;
      this.cash += shortedShares * price;
    }
    if (tradedShares > shareEpsilon) {
      this.recordTrade("sell", candle.timestamp_ms, price, tradedShares, tradePnl, "short");
    }
  }

  // Return to cash: sell a long or cover a short at the open, down to zero.
  flatten(candle: Candle) {
    const price = candle.open;
    if (price <= 0) {
      return;
    }
    if (this.shares > shareEpsilon) {
      const { tradedShares, tradePnl } = this.closeLong(price);
      this.recordTrade("sell", candle.timestamp_ms, price, tradedShares, tradePnl, "cash");
    } else if (this.shares < -shareEpsilon) {
      const { tradedShares, tradePnl } = this.closeShort(price);
      this.recordTrade("buy", candle.timestamp_ms, price, tradedShares, tradePnl, "cash");
    }
  }
}

export const positionEpsilon = shareEpsilon;
