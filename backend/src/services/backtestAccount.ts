import type { BacktestTrade, Candle, TradeCosts } from "../types.ts";

// Ignore float dust so a 100% sell really flattens the position and a
// cash-exhausted account stops producing microscopic buys.
const shareEpsilon = 1e-9;
const minimumTradeValue = 0.01;

export const zeroTradeCosts: TradeCosts = {
  commission_per_trade: 0,
  commission_pct: 0,
  slippage_bps: 0,
};

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
  totalCommission = 0;
  totalSlippageCost = 0;
  readonly trades: BacktestTrade[] = [];
  private readonly buyPercent: number;
  private readonly sellPercent: number;
  private readonly costs: TradeCosts;

  constructor(
    initialCapital: number,
    buyPercent: number,
    sellPercent: number,
    costs: TradeCosts = zeroTradeCosts,
  ) {
    this.cash = initialCapital;
    this.buyPercent = buyPercent;
    this.sellPercent = sellPercent;
    this.costs = costs;
  }

  // Slippage always moves the fill against the account: buys pay above the
  // open, sells receive below it.
  private fillPrice(side: "buy" | "sell", open: number): number {
    const shift = this.costs.slippage_bps / 10_000;
    return side === "buy" ? open * (1 + shift) : open * (1 - shift);
  }

  private commissionRate(): number {
    return this.costs.commission_pct / 100;
  }

  private chargeCommission(tradedValue: number): number {
    const commission = this.costs.commission_per_trade + this.commissionRate() * tradedValue;
    this.cash -= commission;
    this.totalCommission += commission;
    return commission;
  }

  private recordSlippage(open: number, fill: number, tradedShares: number) {
    this.totalSlippageCost += Math.abs(fill - open) * tradedShares;
  }

  private recordTrade(
    side: "buy" | "sell",
    timestampMs: number,
    price: number,
    tradedShares: number,
    commission: number,
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
      commission,
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

  // Largest spend such that spend plus its commission stays within the
  // available cash after any already-committed commission on closingValue.
  private affordableSpend(available: number, closingValue: number): number {
    const budget =
      available - this.costs.commission_per_trade - this.commissionRate() * closingValue;
    return Math.max(0, budget / (1 + this.commissionRate()));
  }

  longOnlyBuy(candle: Candle) {
    const price = this.fillPrice("buy", candle.open);
    const equity = this.cash + this.shares * price;
    const spend = Math.min(
      this.affordableSpend(this.cash, 0),
      (this.buyPercent / 100) * equity,
    );
    if (price <= 0 || spend < minimumTradeValue) {
      return;
    }
    const boughtShares = spend / price;
    this.averageCost = (this.averageCost * this.shares + spend) / (this.shares + boughtShares);
    this.shares += boughtShares;
    this.cash -= spend;
    const commission = this.chargeCommission(spend);
    this.recordSlippage(candle.open, price, boughtShares);
    this.recordTrade("buy", candle.timestamp_ms, price, boughtShares, commission, null);
  }

  longOnlySell(candle: Candle) {
    const price = this.fillPrice("sell", candle.open);
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
    const commission = this.chargeCommission(soldShares * price);
    this.recordSlippage(candle.open, price, soldShares);
    this.recordTrade("sell", candle.timestamp_ms, price, soldShares, commission, tradePnl);
  }

  // Flip to 100% long: cover any short at the open, then spend all cash.
  alwaysInBuy(candle: Candle) {
    const price = this.fillPrice("buy", candle.open);
    if (price <= 0) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    let coverValue = 0;
    if (this.shares < -shareEpsilon) {
      const closed = this.closeShort(price);
      tradePnl = closed.tradePnl;
      tradedShares += closed.tradedShares;
      coverValue = closed.tradedShares * price;
    }
    // A short that moved against the account past its equity leaves negative
    // cash; the account is bust and stays flat.
    const spend = this.affordableSpend(this.cash, coverValue);
    if (spend >= minimumTradeValue) {
      const boughtShares = spend / price;
      this.shares = boughtShares;
      this.averageCost = price;
      tradedShares += boughtShares;
      this.cash -= spend;
    }
    if (tradedShares > shareEpsilon) {
      const commission = this.chargeCommission(tradedShares * price);
      this.recordSlippage(candle.open, price, tradedShares);
      this.recordTrade("buy", candle.timestamp_ms, price, tradedShares, commission, tradePnl, "long");
    }
  }

  // Flip to 100% short: close any long at the open, then short the account's
  // full equity (cash-secured — proceeds sit as collateral, no leverage).
  alwaysInSell(candle: Candle) {
    const price = this.fillPrice("sell", candle.open);
    if (price <= 0 || this.shares < -shareEpsilon) {
      return;
    }
    let tradePnl: number | null = null;
    let tradedShares = 0;
    let closeValue = 0;
    if (this.shares > shareEpsilon) {
      const closed = this.closeLong(price);
      tradePnl = closed.tradePnl;
      tradedShares += closed.tradedShares;
      closeValue = closed.tradedShares * price;
    }
    const shortNotional = this.affordableSpend(this.cash, closeValue);
    if (shortNotional >= minimumTradeValue) {
      const shortedShares = shortNotional / price;
      this.shares = -shortedShares;
      this.averageCost = price;
      tradedShares += shortedShares;
      this.cash += shortNotional;
    }
    if (tradedShares > shareEpsilon) {
      const commission = this.chargeCommission(tradedShares * price);
      this.recordSlippage(candle.open, price, tradedShares);
      this.recordTrade("sell", candle.timestamp_ms, price, tradedShares, commission, tradePnl, "short");
    }
  }

  // Return to cash: sell a long or cover a short at the open, down to zero.
  flatten(candle: Candle) {
    if (this.shares > shareEpsilon) {
      const price = this.fillPrice("sell", candle.open);
      if (price <= 0) {
        return;
      }
      const { tradedShares, tradePnl } = this.closeLong(price);
      const commission = this.chargeCommission(tradedShares * price);
      this.recordSlippage(candle.open, price, tradedShares);
      this.recordTrade("sell", candle.timestamp_ms, price, tradedShares, commission, tradePnl, "cash");
    } else if (this.shares < -shareEpsilon) {
      const price = this.fillPrice("buy", candle.open);
      if (price <= 0) {
        return;
      }
      const { tradedShares, tradePnl } = this.closeShort(price);
      const commission = this.chargeCommission(tradedShares * price);
      this.recordSlippage(candle.open, price, tradedShares);
      this.recordTrade("buy", candle.timestamp_ms, price, tradedShares, commission, tradePnl, "cash");
    }
  }
}

export const positionEpsilon = shareEpsilon;
