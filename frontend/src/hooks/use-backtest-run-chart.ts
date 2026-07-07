import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  listCandles,
  listIndicators,
  type BacktestRunRecord,
  type Candle,
  type IndicatorDefinition,
  type IndicatorKind,
  type IndicatorLineStyle,
  type IndicatorSeries,
  type IndicatorSpec,
} from "@/lib/api";
import { normalizeLineStyles } from "@/lib/indicator-style";
import { strategyIndicatorSpecs } from "@/lib/strategy";
import type { ChartMode, ChartTone } from "@/components/stock-chart";

interface RunChartState {
  chartMode: ChartMode;
  runCandles: Candle[];
  runCandlesLoading: boolean;
  runIndicatorSpecs: IndicatorSpec[];
  runIndicatorSeries: IndicatorSeries[];
  hoverCandle: Candle | null;
}

type RunChartAction =
  | { type: "runCleared" }
  | { type: "runChanged"; specs: IndicatorSpec[] }
  | { type: "chartLoaded"; candles: Candle[]; series: IndicatorSeries[] }
  | { type: "chartLoadFinished" }
  | { type: "modeChanged"; mode: ChartMode }
  | { type: "hoverChanged"; candle: Candle | null }
  | {
      type: "specStylePatched";
      id: string;
      slotIndex: number;
      slotCount: number;
      patch: Partial<IndicatorLineStyle>;
    };

function runChartReducer(state: RunChartState, action: RunChartAction): RunChartState {
  switch (action.type) {
    case "runCleared":
      return {
        ...state,
        hoverCandle: null,
        runCandles: [],
        runIndicatorSeries: [],
        runIndicatorSpecs: [],
      };
    case "runChanged":
      return {
        ...state,
        hoverCandle: null,
        runCandles: [],
        runIndicatorSeries: [],
        runIndicatorSpecs: action.specs,
        runCandlesLoading: true,
      };
    case "chartLoaded":
      return { ...state, runCandles: action.candles, runIndicatorSeries: action.series };
    case "chartLoadFinished":
      return { ...state, runCandlesLoading: false };
    case "modeChanged":
      return { ...state, chartMode: action.mode };
    case "hoverChanged":
      return { ...state, hoverCandle: action.candle };
    case "specStylePatched":
      return {
        ...state,
        runIndicatorSpecs: state.runIndicatorSpecs.map((spec, specIndex) => {
          if (spec.id !== action.id) {
            return spec;
          }

          const styles = normalizeLineStyles(
            spec.styles,
            Math.max(action.slotCount, action.slotIndex + 1),
            specIndex,
          );
          styles[action.slotIndex] = { ...styles[action.slotIndex], ...action.patch };
          return { ...spec, styles };
        }),
      };
  }
}

interface RunChartOptions {
  activeRun: BacktestRunRecord | null;
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  onError: (message: string) => void;
}

/** Price chart data for the active run: its candles plus the indicators its strategy reads. */
export function useBacktestRunChart({ activeRun, definitionsByKind, onError }: RunChartOptions) {
  const [state, dispatch] = useReducer(runChartReducer, {
    chartMode: "line",
    runCandles: [],
    runCandlesLoading: false,
    runIndicatorSpecs: [],
    runIndicatorSeries: [],
    hoverCandle: null,
  });
  const { runCandles, runIndicatorSpecs, runIndicatorSeries, hoverCandle } = state;

  useEffect(() => {
    if (!activeRun) {
      dispatch({ type: "runCleared" });
      return;
    }

    const specs = strategyIndicatorSpecs(activeRun.strategy_snapshot, definitionsByKind);
    dispatch({ type: "runChanged", specs });

    let cancelled = false;
    const request = {
      ticker: activeRun.ticker,
      timeframe: activeRun.timeframe,
      startMs: activeRun.start_ms,
      endMs: activeRun.end_ms,
    };

    Promise.all([
      listCandles(request),
      specs.length > 0 ? listIndicators({ ...request, indicators: specs }) : Promise.resolve([]),
    ])
      .then(([candles, series]) => {
        if (!cancelled) {
          dispatch({ type: "chartLoaded", candles, series });
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          onError(loadError instanceof Error ? loadError.message : "Could not load the run's chart.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          dispatch({ type: "chartLoadFinished" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRun, definitionsByKind, onError]);

  const runIndicatorsForChart = useMemo(() => {
    const specIndexById = new Map(runIndicatorSpecs.map((spec, index) => [spec.id, index]));
    const stylesById = new Map(runIndicatorSpecs.map((spec) => [spec.id, spec.styles]));

    return runIndicatorSeries.map((series) => ({
      ...series,
      styles: normalizeLineStyles(
        stylesById.get(series.id),
        series.values.length,
        specIndexById.get(series.id) ?? 0,
      ),
    }));
  }, [runIndicatorSeries, runIndicatorSpecs]);

  const runSignals = useMemo(
    () =>
      (activeRun?.trades ?? []).map((trade) => ({
        timestamp_ms: trade.timestamp_ms,
        side: trade.side,
      })),
    [activeRun],
  );

  const priceTone: ChartTone = useMemo(() => {
    const first = runCandles.at(0);
    const last = runCandles.at(-1);
    return first && last && last.close < first.close ? "down" : "up";
  }, [runCandles]);

  const legendTimestampMs = (hoverCandle ?? runCandles.at(-1))?.timestamp_ms ?? null;

  const handleHoverCandleChange = useCallback(
    (nextHoverCandle: Candle | null) => dispatch({ type: "hoverChanged", candle: nextHoverCandle }),
    [],
  );

  function updateRunIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    const spec = runIndicatorSpecs.find((candidate) => candidate.id === id);
    const definition = spec ? definitionsByKind.get(spec.kind) : undefined;
    dispatch({
      type: "specStylePatched",
      id,
      slotIndex,
      slotCount: definition?.values?.length ?? slotIndex + 1,
      patch,
    });
  }

  return {
    ...state,
    runIndicatorsForChart,
    runSignals,
    priceTone,
    legendTimestampMs,
    setChartMode: (mode: ChartMode) => dispatch({ type: "modeChanged", mode }),
    handleHoverCandleChange,
    updateRunIndicatorLineStyle,
  };
}
