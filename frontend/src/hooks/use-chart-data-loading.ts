import { useEffect, type Dispatch } from "react";

import { listCandles, listIndicators, type IndicatorSpec } from "@/lib/api";
import type { TimeWindow } from "@/hooks/chart-display";
import type { ChartWorkspaceAction } from "@/hooks/chart-workspace-state";

interface ChartDataLoadingOptions {
  selectedTicker: string;
  timeframe: string;
  range: string;
  candleRequestWindow: TimeWindow | undefined;
  /** Serialized request specs; changes only when an indicator's identity or parameters change. */
  indicatorRequestKey: string;
  indicatorRequestSpecs: IndicatorSpec[];
  dispatch: Dispatch<ChartWorkspaceAction>;
  onError: (message: string | null) => void;
}

/** Fetches candles and indicator series whenever the selection or window changes. */
export function useChartDataLoading({
  selectedTicker,
  timeframe,
  range,
  candleRequestWindow,
  indicatorRequestKey,
  indicatorRequestSpecs,
  dispatch,
  onError,
}: ChartDataLoadingOptions) {
  useEffect(() => {
    if (!selectedTicker || !candleRequestWindow) {
      dispatch({ type: "candlesUnavailable" });
      return;
    }

    let cancelled = false;
    const requestTicker = selectedTicker;
    const requestTimeframe = timeframe;
    const requestWindow = candleRequestWindow;

    async function loadCandles() {
      dispatch({ type: "candlesRequested" });
      onError(null);

      try {
        const nextCandles = await listCandles({
          ticker: requestTicker,
          timeframe: requestTimeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
        });

        if (!cancelled) {
          dispatch({
            type: "candlesLoaded",
            data: {
              ticker: requestTicker,
              timeframe: requestTimeframe,
              startMs: requestWindow.startMs,
              endMs: requestWindow.endMs,
              candles: nextCandles,
            },
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          dispatch({ type: "candlesFailed" });
          onError(loadError instanceof Error ? loadError.message : "Could not load candles.");
        }
      }
    }

    loadCandles();
    return () => {
      cancelled = true;
    };
  }, [selectedTicker, timeframe, candleRequestWindow, dispatch, onError]);

  useEffect(() => {
    if (!selectedTicker || !candleRequestWindow || indicatorRequestSpecs.length === 0) {
      dispatch({ type: "indicatorsCleared" });
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;

    async function loadIndicators() {
      dispatch({ type: "indicatorsRequested" });
      onError(null);

      try {
        const nextSeries = await listIndicators({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          indicators: indicatorRequestSpecs,
        });

        if (!cancelled) {
          dispatch({ type: "indicatorSeriesLoaded", series: nextSeries });
        }
      } catch (loadError) {
        if (!cancelled) {
          dispatch({ type: "indicatorsFailed" });
          onError(loadError instanceof Error ? loadError.message : "Could not load indicators.");
        }
      }
    }

    loadIndicators();
    return () => {
      cancelled = true;
    };
  }, [
    candleRequestWindow,
    indicatorRequestKey,
    indicatorRequestSpecs,
    selectedTicker,
    timeframe,
    dispatch,
    onError,
  ]);

  // A new ticker, timeframe, or range invalidates whatever window the chart
  // last reported as visible.
  useEffect(() => {
    dispatch({ type: "visibleCandlesReset" });
  }, [range, selectedTicker, timeframe, dispatch]);
}
