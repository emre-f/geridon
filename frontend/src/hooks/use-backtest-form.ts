import { useMemo, useReducer } from "react";

import type { BacktestPositionMode, StrategyRecord, SymbolSummary } from "@/lib/api";
import { toDateInputValue } from "@/lib/backtest-utils";
import { availableTimeframes, coverageForTimeframe } from "@/lib/chart-options";

/** Date range the user edited, tagged with the coverage it was edited for. */
interface EditedDates {
  startDate: string;
  endDate: string;
  coverageKey: string;
}

interface BacktestFormState {
  strategyId: number | null;
  ticker: string;
  timeframe: string;
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  dates: EditedDates | null;
}

type EditableField = Pick<
  BacktestFormState,
  "strategyId" | "ticker" | "timeframe" | "positionMode" | "buyPercent" | "sellPercent" | "initialCapital"
>;

type BacktestFormAction =
  | { type: "fieldChanged"; patch: Partial<EditableField> }
  | { type: "datesEdited"; dates: EditedDates };

function backtestFormReducer(
  state: BacktestFormState,
  action: BacktestFormAction,
): BacktestFormState {
  switch (action.type) {
    case "fieldChanged":
      return { ...state, ...action.patch };
    case "datesEdited":
      return { ...state, dates: action.dates };
  }
}

interface BacktestFormOptions {
  strategies: StrategyRecord[];
  initialStrategyId: number | null;
  symbols: SymbolSummary[];
  defaultTicker: string;
}

/**
 * The run-configuration form. Raw user choices live in the reducer; the
 * returned values fall back at render time whenever stored data changed
 * underneath them (strategy deleted, symbol removed, timeframe uncovered),
 * so no effect has to sync state.
 */
export function useBacktestForm({
  strategies,
  initialStrategyId,
  symbols,
  defaultTicker,
}: BacktestFormOptions) {
  const [form, dispatch] = useReducer(backtestFormReducer, {
    strategyId: initialStrategyId,
    ticker: defaultTicker,
    timeframe: "1d",
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    dates: null,
  });

  const strategyId =
    strategies.length === 0
      ? null
      : form.strategyId != null && strategies.some((strategy) => strategy.id === form.strategyId)
        ? form.strategyId
        : initialStrategyId != null &&
            strategies.some((strategy) => strategy.id === initialStrategyId)
          ? initialStrategyId
          : strategies[0].id;
  const ticker =
    symbols.length > 0 && !symbols.some((symbol) => symbol.ticker === form.ticker)
      ? symbols.some((symbol) => symbol.ticker === defaultTicker)
        ? defaultTicker
        : symbols[0].ticker
      : form.ticker;
  // three_state needs a go-to-cash tree, so fall back when the selected
  // strategy doesn't define one.
  const positionMode =
    form.positionMode === "three_state" &&
    strategies.find((strategy) => strategy.id === strategyId)?.cash == null
      ? "long_only"
      : form.positionMode;

  const selectedSymbol = useMemo(
    () => symbols.find((symbol) => symbol.ticker === ticker) ?? symbols[0],
    [symbols, ticker],
  );
  const tickerList = useMemo(() => symbols.map((symbol) => symbol.ticker), [symbols]);
  const timeframes = useMemo(() => availableTimeframes(selectedSymbol), [selectedSymbol]);
  const timeframe =
    timeframes.length > 0 && !timeframes.includes(form.timeframe)
      ? timeframes.includes("1d")
        ? "1d"
        : timeframes[0]
      : form.timeframe;
  const coverage = useMemo(
    () => coverageForTimeframe(selectedSymbol, timeframe),
    [selectedSymbol, timeframe],
  );

  // Dates default to the full stored coverage; user edits stick until the
  // coverage they were made for changes, then evict themselves.
  const coverageKey = coverage
    ? `${selectedSymbol?.ticker}|${timeframe}|${coverage.start_ms}|${coverage.end_ms}`
    : "";
  const datesValid = form.dates != null && form.dates.coverageKey === coverageKey;
  const startDate = datesValid ? form.dates!.startDate : coverage ? toDateInputValue(coverage.start_ms) : "";
  const endDate = datesValid ? form.dates!.endDate : coverage ? toDateInputValue(coverage.end_ms) : "";

  return {
    ...form,
    strategyId,
    ticker,
    positionMode,
    timeframe,
    startDate,
    endDate,
    selectedSymbol,
    tickerList,
    timeframes,
    coverage,
    setStrategyId: (nextId: number | null) =>
      dispatch({ type: "fieldChanged", patch: { strategyId: nextId } }),
    setTicker: (nextTicker: string) => dispatch({ type: "fieldChanged", patch: { ticker: nextTicker } }),
    setTimeframe: (nextTimeframe: string) =>
      dispatch({ type: "fieldChanged", patch: { timeframe: nextTimeframe } }),
    setStartDate: (nextStartDate: string) =>
      dispatch({ type: "datesEdited", dates: { startDate: nextStartDate, endDate, coverageKey } }),
    setEndDate: (nextEndDate: string) =>
      dispatch({ type: "datesEdited", dates: { startDate, endDate: nextEndDate, coverageKey } }),
    setPositionMode: (positionMode: BacktestPositionMode) =>
      dispatch({ type: "fieldChanged", patch: { positionMode } }),
    setBuyPercent: (buyPercent: number) => dispatch({ type: "fieldChanged", patch: { buyPercent } }),
    setSellPercent: (sellPercent: number) =>
      dispatch({ type: "fieldChanged", patch: { sellPercent } }),
    setInitialCapital: (initialCapital: number) =>
      dispatch({ type: "fieldChanged", patch: { initialCapital } }),
  };
}
