import { useCallback, useEffect, useReducer } from "react";

import {
  deleteBacktest,
  getBacktest,
  listStrategyBacktests,
  runBacktest,
  type BacktestRunRecord,
  type BacktestRunSummary,
} from "@/lib/api";
import { dayEndMs, dayStartMs, formatRanAt } from "@/lib/backtest-utils";
import type { useBacktestForm } from "@/hooks/use-backtest-form";

interface BacktestRunsState {
  runs: BacktestRunSummary[];
  runsLoading: boolean;
  activeRun: BacktestRunRecord | null;
  openingRunId: number | null;
  running: boolean;
  error: string | null;
}

type BacktestRunsAction =
  | { type: "strategyReset" }
  | { type: "runsRequested" }
  | { type: "runsLoaded"; runs: BacktestRunSummary[] }
  | { type: "runsFailed"; message: string }
  | { type: "runStarted" }
  | { type: "runCompleted"; record: BacktestRunRecord }
  | { type: "runFinished" }
  | { type: "openStarted"; id: number }
  | { type: "openSucceeded"; record: BacktestRunRecord }
  | { type: "openFinished" }
  | { type: "deleteSucceeded"; id: number }
  | { type: "runClosed" }
  | { type: "errorSet"; message: string | null };

function summaryFromRecord(record: BacktestRunRecord): BacktestRunSummary {
  return {
    id: record.id,
    strategy_id: record.strategy_id,
    ticker: record.ticker,
    timeframe: record.timeframe,
    start_ms: record.start_ms,
    end_ms: record.end_ms,
    position_mode: record.position_mode,
    buy_percent: record.buy_percent,
    sell_percent: record.sell_percent,
    initial_capital: record.initial_capital,
    metrics: record.metrics,
    strategy_outdated: record.strategy_outdated,
    created_at: record.created_at,
  };
}

function backtestRunsReducer(
  state: BacktestRunsState,
  action: BacktestRunsAction,
): BacktestRunsState {
  switch (action.type) {
    case "strategyReset":
      return { ...state, runs: [], activeRun: null, error: null };
    case "runsRequested":
      return { ...state, runsLoading: true };
    case "runsLoaded":
      return { ...state, runs: action.runs, runsLoading: false };
    case "runsFailed":
      return { ...state, error: action.message, runsLoading: false };
    case "runStarted":
      return { ...state, running: true, error: null };
    case "runCompleted":
      return {
        ...state,
        activeRun: action.record,
        runs: [summaryFromRecord(action.record), ...state.runs],
      };
    case "runFinished":
      return { ...state, running: false };
    case "openStarted":
      return { ...state, openingRunId: action.id, error: null };
    case "openSucceeded":
      return { ...state, activeRun: action.record };
    case "openFinished":
      return { ...state, openingRunId: null };
    case "deleteSucceeded":
      return {
        ...state,
        runs: state.runs.filter((run) => run.id !== action.id),
        activeRun: state.activeRun?.id === action.id ? null : state.activeRun,
      };
    case "runClosed":
      return { ...state, activeRun: null };
    case "errorSet":
      return { ...state, error: action.message };
  }
}

interface BacktestRunsOptions {
  form: ReturnType<typeof useBacktestForm>;
  /** Bumped when the strategy definition is saved, so "older rules" flags stay accurate. */
  strategyUpdatedAt: string | null;
}

/** Past runs for the selected strategy, plus running, opening, and deleting them. */
export function useBacktestRuns({ form, strategyUpdatedAt }: BacktestRunsOptions) {
  const [state, dispatch] = useReducer(backtestRunsReducer, {
    runs: [],
    runsLoading: false,
    activeRun: null,
    openingRunId: null,
    running: false,
    error: null,
  });
  const { strategyId } = form;

  useEffect(() => {
    dispatch({ type: "strategyReset" });

    if (strategyId == null) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "runsRequested" });

    listStrategyBacktests(strategyId)
      .then((records) => {
        if (!cancelled) {
          dispatch({ type: "runsLoaded", runs: records });
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          dispatch({
            type: "runsFailed",
            message: loadError instanceof Error ? loadError.message : "Could not load past runs.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [strategyId, strategyUpdatedAt]);

  async function handleRun() {
    if (strategyId == null || !form.selectedSymbol) {
      return;
    }

    const startMs = dayStartMs(form.startDate);
    const endMs = dayEndMs(form.endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      dispatch({ type: "errorSet", message: "Pick a valid date range." });
      return;
    }

    dispatch({ type: "runStarted" });
    try {
      const record = await runBacktest({
        strategyId,
        ticker: form.selectedSymbol.ticker,
        timeframe: form.timeframe,
        startMs,
        endMs,
        positionMode: form.positionMode,
        buyPercent: form.buyPercent,
        sellPercent: form.sellPercent,
        initialCapital: form.initialCapital,
      });
      dispatch({ type: "runCompleted", record });
    } catch (runError) {
      dispatch({
        type: "errorSet",
        message: runError instanceof Error ? runError.message : "Could not run the backtest.",
      });
    } finally {
      dispatch({ type: "runFinished" });
    }
  }

  async function handleOpenRun(run: BacktestRunSummary) {
    if (state.activeRun?.id === run.id) {
      return;
    }

    dispatch({ type: "openStarted", id: run.id });
    try {
      dispatch({ type: "openSucceeded", record: await getBacktest(run.id) });
    } catch (openError) {
      dispatch({
        type: "errorSet",
        message: openError instanceof Error ? openError.message : "Could not load the run.",
      });
    } finally {
      dispatch({ type: "openFinished" });
    }
  }

  async function handleDeleteRun(run: BacktestRunSummary) {
    if (!window.confirm(`Delete this ${run.ticker} run from ${formatRanAt(run.created_at)}?`)) {
      return;
    }

    dispatch({ type: "errorSet", message: null });
    try {
      await deleteBacktest(run.id);
      dispatch({ type: "deleteSucceeded", id: run.id });
    } catch (deleteError) {
      dispatch({
        type: "errorSet",
        message: deleteError instanceof Error ? deleteError.message : "Could not delete the run.",
      });
    }
  }

  // Stable identity: this lands in effect dependency arrays downstream.
  const reportError = useCallback(
    (message: string) => dispatch({ type: "errorSet", message }),
    [],
  );

  return {
    ...state,
    handleRun,
    handleOpenRun,
    handleDeleteRun,
    closeRun: () => dispatch({ type: "runClosed" }),
    reportError,
  };
}
