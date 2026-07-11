import { useMemo, useReducer } from "react";

import type { OptimizationMethod, StrategyRecord, SymbolSummary } from "@/lib/api";
import { toDateInputValue } from "@/lib/backtest-utils";
import { availableTimeframes, coverageForTimeframe } from "@/lib/chart-options";

interface EditedDates {
  startDate: string;
  endDate: string;
  coverageKey: string;
}

interface OptimizeFormState {
  strategyId: number | null;
  ticker: string;
  timeframe: string;
  method: OptimizationMethod;
  maxTrials: number;
  maxRuntimeMinutes: number;
  foldCount: number;
  seed: number;
  dates: EditedDates | null;
}

type EditableField = Pick<
  OptimizeFormState,
  "strategyId" | "ticker" | "timeframe" | "method" | "maxTrials" | "maxRuntimeMinutes" | "foldCount" | "seed"
>;

type OptimizeFormAction =
  | { type: "fieldChanged"; patch: Partial<EditableField> }
  | { type: "datesEdited"; dates: EditedDates };

function optimizeFormReducer(state: OptimizeFormState, action: OptimizeFormAction): OptimizeFormState {
  switch (action.type) {
    case "fieldChanged":
      return { ...state, ...action.patch };
    case "datesEdited":
      return { ...state, dates: action.dates };
  }
}

interface OptimizeFormOptions {
  strategies: StrategyRecord[];
  initialStrategyId: number | null;
  symbols: SymbolSummary[];
  defaultTicker: string;
}

/** Fields for a new optimization experiment; mirrors useBacktestForm's fallback pattern. */
export function useOptimizeExperimentForm({
  strategies,
  initialStrategyId,
  symbols,
  defaultTicker,
}: OptimizeFormOptions) {
  const [form, dispatch] = useReducer(optimizeFormReducer, {
    strategyId: initialStrategyId,
    ticker: defaultTicker,
    timeframe: "1d",
    method: "random",
    maxTrials: 50,
    maxRuntimeMinutes: 2,
    foldCount: 4,
    seed: 1,
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
    setMethod: (method: OptimizationMethod) => dispatch({ type: "fieldChanged", patch: { method } }),
    setMaxTrials: (maxTrials: number) => dispatch({ type: "fieldChanged", patch: { maxTrials } }),
    setMaxRuntimeMinutes: (maxRuntimeMinutes: number) =>
      dispatch({ type: "fieldChanged", patch: { maxRuntimeMinutes } }),
    setFoldCount: (foldCount: number) => dispatch({ type: "fieldChanged", patch: { foldCount } }),
    setSeed: (seed: number) => dispatch({ type: "fieldChanged", patch: { seed } }),
    setStartDate: (nextStartDate: string) =>
      dispatch({ type: "datesEdited", dates: { startDate: nextStartDate, endDate, coverageKey } }),
    setEndDate: (nextEndDate: string) =>
      dispatch({ type: "datesEdited", dates: { startDate, endDate: nextEndDate, coverageKey } }),
  };
}
