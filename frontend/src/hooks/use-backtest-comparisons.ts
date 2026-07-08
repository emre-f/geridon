import { useEffect, useMemo, useReducer, useRef } from "react";

import {
  listCandles,
  type BacktestRunRecord,
  type IndicatorLineStyle,
  type SymbolSummary,
} from "@/lib/api";
import {
  comparisonCacheKey,
  createComparisonId,
  holdCurve,
  type ComparisonPoint,
} from "@/lib/backtest-utils";
import { defaultLineStyle } from "@/lib/indicator-style";
import type { ComparisonSlot } from "@/components/backtest-types";
import type { EquityOverlay } from "@/components/equity-chart";

export const maxComparisons = 3;
const preferredComparisonTickers = ["SPY", "QQQ"];

interface ComparisonsState {
  /** Whether the "hold the backtested stock" benchmark line is shown. */
  holdSelfVisible: boolean;
  holdSelfStyle: IndicatorLineStyle;
  comparisons: ComparisonSlot[];
  /** Buy-and-hold close series per comparison cache key; [] caches a coverage miss. */
  comparisonData: Record<string, ComparisonPoint[]>;
}

type ComparisonsAction =
  | { type: "holdSelfVisibleChanged"; visible: boolean }
  | { type: "holdSelfStylePatched"; patch: Partial<IndicatorLineStyle> }
  | { type: "comparisonAdded"; id: string; tickers: string[]; activeTicker: string | undefined }
  | { type: "comparisonChanged"; id: string; patch: Partial<ComparisonSlot> }
  | { type: "comparisonRemoved"; id: string }
  | { type: "comparisonDataLoaded"; key: string; points: ComparisonPoint[] };

function comparisonsReducer(state: ComparisonsState, action: ComparisonsAction): ComparisonsState {
  switch (action.type) {
    case "holdSelfVisibleChanged":
      return { ...state, holdSelfVisible: action.visible };
    case "holdSelfStylePatched":
      return { ...state, holdSelfStyle: { ...state.holdSelfStyle, ...action.patch } };
    case "comparisonAdded": {
      if (state.comparisons.length >= maxComparisons) {
        return state;
      }

      const used = new Set([action.activeTicker, ...state.comparisons.map((slot) => slot.ticker)]);
      const nextTicker =
        preferredComparisonTickers.find(
          (candidate) => !used.has(candidate) && action.tickers.includes(candidate),
        ) ??
        action.tickers.find((ticker) => !used.has(ticker)) ??
        action.tickers[0];
      if (!nextTicker) {
        return state;
      }

      return {
        ...state,
        comparisons: [
          ...state.comparisons,
          {
            id: action.id,
            ticker: nextTicker,
            visible: true,
            style: defaultLineStyle(state.comparisons.length + 1),
          },
        ],
      };
    }
    case "comparisonChanged":
      return {
        ...state,
        comparisons: state.comparisons.map((slot) =>
          slot.id === action.id ? { ...slot, ...action.patch } : slot,
        ),
      };
    case "comparisonRemoved":
      return {
        ...state,
        comparisons: state.comparisons.filter((slot) => slot.id !== action.id),
      };
    case "comparisonDataLoaded":
      return { ...state, comparisonData: { ...state.comparisonData, [action.key]: action.points } };
  }
}

interface ComparisonsOptions {
  activeRun: BacktestRunRecord | null;
  symbols: SymbolSummary[];
}

/** PnL comparison overlays: "hold the backtested stock" plus custom tickers. */
export function useBacktestComparisons({ activeRun, symbols }: ComparisonsOptions) {
  const [state, dispatch] = useReducer(comparisonsReducer, undefined, () => ({
    holdSelfVisible: true,
    holdSelfStyle: { ...defaultLineStyle(0), stroke: "dashed" as const },
    comparisons: [],
    comparisonData: {},
  }));
  const { holdSelfVisible, holdSelfStyle, comparisons, comparisonData } = state;
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
    if (holdSelfVisible) {
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
  }, [activeRun, comparisons, comparisonData, holdSelfVisible, comparisonRequests]);

  const equityOverlays = useMemo<EquityOverlay[]>(() => {
    if (!activeRun) {
      return [];
    }

    const overlays: EquityOverlay[] = [];
    if (holdSelfVisible) {
      const data = comparisonData[comparisonCacheKey(activeRun.ticker, activeRun)];
      if (data && data.length > 0) {
        overlays.push({
          id: "hold-self",
          label: `Hold ${activeRun.ticker}`,
          style: holdSelfStyle,
          points: holdCurve(data, activeRun.initial_capital),
        });
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
  }, [activeRun, comparisonData, comparisons, holdSelfStyle, holdSelfVisible]);

  return {
    holdSelfVisible,
    holdSelfStyle,
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
    setHoldSelfVisible: (visible: boolean) => dispatch({ type: "holdSelfVisibleChanged", visible }),
    patchHoldSelfStyle: (patch: Partial<IndicatorLineStyle>) =>
      dispatch({ type: "holdSelfStylePatched", patch }),
  };
}
