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
  trigger_index: number;
  horizon_candles: number;
  entry_price: number;
  exit_price: number;
  net_pnl: number;
  return_pct: number;
  label: 0 | 1;
}

export interface TradeEventDataset {
  symbol: string;
  rows: TradeEventRow[];
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
