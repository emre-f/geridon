import { useEffect, useMemo, useReducer, useRef } from "react";

import {
  listCandles,
  type BacktestRunRecord,
  type IndicatorLineStyle,
  type SymbolSummary,
} from "@/lib/api";
import { comparisonCacheKey, createComparisonId, holdCurve } from "@/lib/backtest-utils";
import type { BenchmarkId, BenchmarkView, ComparisonSlot } from "@/components/backtest-types";
import type { EquityOverlay } from "@/components/equity-chart";
import {
  benchmarkDefinitions,
  comparisonsReducer,
  initialComparisonsState,
} from "@/hooks/backtest-comparisons-state";

export { maxComparisons } from "@/hooks/backtest-comparisons-state";

interface ComparisonsOptions {
  activeRun: BacktestRunRecord | null;
  symbols: SymbolSummary[];
}

/** PnL comparison overlays: built-in benchmarks plus custom tickers. */
export function useBacktestComparisons({ activeRun, symbols }: ComparisonsOptions) {
  const [state, dispatch] = useReducer(comparisonsReducer, undefined, initialComparisonsState);
  const { benchmarks, comparisons, comparisonData } = state;
  const anyBenchmarkVisible = benchmarkDefinitions.some(
    (definition) => benchmarks[definition.id].visible,
  );
  // Lazy init: `useRef(new Set())` would allocate and discard a Set per render.
  const comparisonRequestsRef = useRef<Set<string> | null>(null);
  comparisonRequestsRef.current ??= new Set();
  const comparisonRequests = comparisonRequestsRef.current;

  // Fetch buy-and-hold candles for every visible comparison that lacks data.
  useEffect(() => {
    if (!activeRun) {
      return;
    }

    const wantedTickers = new Set<string>();
    if (anyBenchmarkVisible) {
      wantedTickers.add(activeRun.ticker);
    }
    for (const slot of comparisons) {
      if (slot.visible && slot.ticker) {
        wantedTickers.add(slot.ticker);
      }
    }

    for (const wantedTicker of wantedTickers) {
      const key = comparisonCacheKey(wantedTicker, activeRun);
      if (comparisonData[key] || comparisonRequests.has(key)) {
        continue;
      }
      comparisonRequests.add(key);

      listCandles({
        ticker: wantedTicker,
        timeframe: activeRun.timeframe,
        startMs: activeRun.start_ms,
        endMs: activeRun.end_ms,
      })
        .then((candles) => {
          dispatch({
            type: "comparisonDataLoaded",
            key,
            points: candles.map((candle) => ({
              timestamp_ms: candle.timestamp_ms,
              close: candle.close,
            })),
          });
        })
        .catch(() => {
          // Cache the miss so a symbol without coverage isn't refetched.
          dispatch({ type: "comparisonDataLoaded", key, points: [] });
        })
        .finally(() => {
          comparisonRequests.delete(key);
        });
    }
  }, [activeRun, comparisons, comparisonData, anyBenchmarkVisible, comparisonRequests]);

  const benchmarkViews = useMemo<BenchmarkView[]>(
    () =>
      activeRun == null
        ? []
        : benchmarkDefinitions.map((definition) => ({
            id: definition.id,
            label: definition.label(activeRun),
            title: definition.title,
            visible: benchmarks[definition.id].visible,
            style: benchmarks[definition.id].style,
          })),
    [activeRun, benchmarks],
  );

  const equityOverlays = useMemo<EquityOverlay[]>(() => {
    if (!activeRun) {
      return [];
    }

    const overlays: EquityOverlay[] = [];
    const selfData = comparisonData[comparisonCacheKey(activeRun.ticker, activeRun)];
    if (selfData && selfData.length > 0) {
      for (const definition of benchmarkDefinitions) {
        const slot = benchmarks[definition.id];
        if (slot.visible) {
          overlays.push({
            id: definition.id,
            label: definition.label(activeRun),
            style: slot.style,
            points: definition.curve(selfData, activeRun.initial_capital),
          });
        }
      }
    }
    for (const slot of comparisons) {
      if (!slot.visible || !slot.ticker) {
        continue;
      }
      const data = comparisonData[comparisonCacheKey(slot.ticker, activeRun)];
      if (data && data.length > 0) {
        overlays.push({
          id: slot.id,
          label: slot.ticker,
          style: slot.style,
          points: holdCurve(data, activeRun.initial_capital),
        });
      }
    }
    return overlays;
  }, [activeRun, benchmarks, comparisonData, comparisons]);

  return {
    benchmarks: benchmarkViews,
    comparisons,
    comparisonData,
    equityOverlays,
    addComparison: () =>
      dispatch({
        type: "comparisonAdded",
        id: createComparisonId(),
        tickers: symbols.map((symbol) => symbol.ticker),
        activeTicker: activeRun?.ticker,
      }),
    updateComparison: (id: string, patch: Partial<ComparisonSlot>) =>
      dispatch({ type: "comparisonChanged", id, patch }),
    removeComparison: (id: string) => dispatch({ type: "comparisonRemoved", id }),
    setBenchmarkVisible: (id: BenchmarkId, visible: boolean) =>
      dispatch({ type: "benchmarkVisibleChanged", id, visible }),
    patchBenchmarkStyle: (id: BenchmarkId, patch: Partial<IndicatorLineStyle>) =>
      dispatch({ type: "benchmarkStylePatched", id, patch }),
  };
}
