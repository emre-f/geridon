import { runBacktest } from "../backtest.ts";
import { positionEpsilon } from "../backtestAccount.ts";
import type {
  BacktestPositionMode,
  BacktestTrade,
  Candle,
  Strategy,
  TradeCosts,
} from "../../types.ts";

export interface TradeEventRow {
  symbol: string;
  side: "long" | "short";
  entry_timestamp_ms: number;
  exit_timestamp_ms: number;
  entry_index: number;
  exit_index: number;
  /** The bar whose close fired the signal; fills happen on the next bar's open. */
  trigger_index: number;
  /** Bars from entry fill to exit fill; the label horizon recorded per row. */
  horizon_candles: number;
  entry_price: number;
  exit_price: number;
  /** Equity change across the round trip, net of commission and slippage. */
  net_pnl: number;
  return_pct: number;
  /** 1 when the trade cleared its costs (net PnL positive). */
  label: 0 | 1;
}

export interface TradeEventDataset {
  symbol: string;
  rows: TradeEventRow[];
  /** Entries still open when the window ended; they have no outcome and no row. */
  open_trades: number;
}

export interface TradeEventOptions {
  symbol: string;
  strategy: Strategy;
  candles: Candle[];
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  costs?: TradeCosts;
  simulationStartIndex?: number;
}

type PositionSide = "long" | "short" | "flat";

function positionSide(shares: number): PositionSide {
  if (shares > positionEpsilon) {
    return "long";
  }
  if (shares < -positionEpsilon) {
    return "short";
  }
  return "flat";
}

interface OpenEvent {
  side: "long" | "short";
  entryFill: BacktestTrade;
  preEntryEquity: number;
}

function closedRow(
  symbol: string,
  open: OpenEvent,
  exitFill: BacktestTrade,
  indexByTimestamp: Map<number, number>,
): TradeEventRow {
  const entryIndex = indexByTimestamp.get(open.entryFill.timestamp_ms) ?? 0;
  const exitIndex = indexByTimestamp.get(exitFill.timestamp_ms) ?? entryIndex;
  const netPnl = exitFill.equity_after - open.preEntryEquity;
  return {
    symbol,
    side: open.side,
    entry_timestamp_ms: open.entryFill.timestamp_ms,
    exit_timestamp_ms: exitFill.timestamp_ms,
    entry_index: entryIndex,
    exit_index: exitIndex,
    trigger_index: Math.max(0, entryIndex - 1),
    horizon_candles: exitIndex - entryIndex,
    entry_price: open.entryFill.price,
    exit_price: exitFill.price,
    net_pnl: netPnl,
    return_pct: (netPnl / open.preEntryEquity) * 100,
    label: netPnl > 0 ? 1 : 0,
  };
}

/**
 * One row per entry trigger of the baseline strategy, labelled by whether the
 * round trip cleared its configured costs. An event opens when a fill takes
 * the account out of flat and closes when a fill returns it to flat; a
 * stop-and-reverse fill closes the old event and opens the new one at the
 * same bar, attributing the flip fill's costs to the trade it closed. Scaling
 * fills inside one side extend the same event. Runs the ordinary
 * non-persisting simulator, so costs and fill timing match backtests exactly.
 */
export function buildTradeEvents(options: TradeEventOptions): TradeEventDataset {
  const result = runBacktest({
    strategy: options.strategy,
    candles: options.candles,
    positionMode: options.positionMode,
    buyPercent: options.buyPercent,
    sellPercent: options.sellPercent,
    initialCapital: options.initialCapital,
    costs: options.costs,
    simulationStartIndex: options.simulationStartIndex,
  });

  const indexByTimestamp = new Map(
    options.candles.map((candle, index) => [candle.timestamp_ms, index]),
  );
  const rows: TradeEventRow[] = [];
  let open: OpenEvent | null = null;
  let flatEquity = options.initialCapital;

  for (const fill of result.trades) {
    const side = positionSide(fill.shares_after);
    if (open == null) {
      if (side === "flat") {
        flatEquity = fill.equity_after;
      } else {
        open = { side, entryFill: fill, preEntryEquity: flatEquity };
      }
      continue;
    }
    if (side === "flat") {
      rows.push(closedRow(options.symbol, open, fill, indexByTimestamp));
      flatEquity = fill.equity_after;
      open = null;
    } else if (side !== open.side) {
      rows.push(closedRow(options.symbol, open, fill, indexByTimestamp));
      open = { side, entryFill: fill, preEntryEquity: fill.equity_after };
    }
  }

  return { symbol: options.symbol, rows, open_trades: open == null ? 0 : 1 };
}
