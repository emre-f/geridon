import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type {
  Candle,
  IndicatorDefinition,
  IndicatorKind,
  IndicatorLineStyle,
  IndicatorParameterDefinition,
  IndicatorSpec,
  SymbolSummary,
} from "@/lib/api";
import type { AppTab } from "@/lib/app-types";
import {
  availableTimeframes,
  coverageWindow,
  defaultRangeForTimeframe,
  queryWindow,
  timeframeForRange,
} from "@/lib/chart-options";
import { loadChartState, saveChartState } from "@/lib/chart-state";
import { definitionValueSlots, normalizeLineStyles } from "@/lib/indicator-style";
import { chartDisplay, priceSummary, type ChartDisplayWindow } from "@/hooks/chart-display";
import {
  chartWorkspaceReducer,
  initialChartWorkspaceState,
} from "@/hooks/chart-workspace-state";
import { useChartDataLoading } from "@/hooks/use-chart-data-loading";
import type { ChartMode } from "@/components/stock-chart";

const defaultTimeframe = "1d";

interface ChartWorkspaceOptions {
  activeTab: AppTab;
  selectedSymbol: SymbolSummary | undefined;
  selectedTicker: string;
  indicatorDefinitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  onError: (message: string | null) => void;
}

function createIndicatorId(kind: IndicatorKind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns the Charts tab: per-ticker display preferences (mode, timeframe,
 * range, indicators), candle/indicator loading, and the derived values the
 * chart panel renders.
 */
export function useChartWorkspace({
  activeTab,
  selectedSymbol,
  selectedTicker,
  indicatorDefinitionsByKind,
  onError,
}: ChartWorkspaceOptions) {
  const [state, dispatch] = useReducer(
    chartWorkspaceReducer,
    initialChartWorkspaceState(defaultTimeframe, defaultRangeForTimeframe(defaultTimeframe)),
  );
  const { chartMode, timeframe, range, activeIndicators, hoverCandle } = state;
  const lastChartDisplayRef = useRef<ChartDisplayWindow | null>(null);

  const timeframes = useMemo(() => availableTimeframes(selectedSymbol), [selectedSymbol]);
  const candleWindow = useMemo(
    () => queryWindow(selectedSymbol, timeframe, range),
    [range, selectedSymbol, timeframe],
  );
  const candleRequestWindow = useMemo(
    () => coverageWindow(selectedSymbol, timeframe),
    [selectedSymbol, timeframe],
  );
  const display = chartDisplay({
    candleData: state.candleData,
    candleWindow,
    candleRequestWindow,
    selectedTicker,
    timeframe,
    lastDisplay: lastChartDisplayRef.current,
  });
  const indicatorRequestKey = useMemo(
    () =>
      JSON.stringify(
        activeIndicators.map(({ id, kind, parameters }) => ({ id, kind, parameters })),
      ),
    [activeIndicators],
  );
  const indicatorRequestSpecs = useMemo(
    () => JSON.parse(indicatorRequestKey) as IndicatorSpec[],
    [indicatorRequestKey],
  );
  const indicatorsForChart = useMemo(() => {
    const specIndexById = new Map(activeIndicators.map((indicator, index) => [indicator.id, index]));
    const stylesById = new Map(activeIndicators.map((indicator) => [indicator.id, indicator.styles]));

    return state.indicatorSeries.map((series) => ({
      ...series,
      styles: normalizeLineStyles(
        stylesById.get(series.id),
        series.values.length,
        specIndexById.get(series.id) ?? 0,
      ),
    }));
  }, [activeIndicators, state.indicatorSeries]);
  const summary = priceSummary(
    state.visibleCandles,
    display.chartCandles,
    timeframe,
    candleWindow,
    hoverCandle,
  );

  // Persist per-ticker chart preferences while the Charts tab is active.
  useEffect(() => {
    if (!selectedTicker || activeTab !== "charts") {
      return;
    }

    saveChartState(selectedTicker, { chartMode, timeframe, range, indicators: activeIndicators });
  }, [activeIndicators, activeTab, chartMode, range, selectedTicker, timeframe]);

  // A symbol change can leave a timeframe selected that it doesn't cover.
  useEffect(() => {
    if (!selectedSymbol || timeframes.length === 0 || timeframes.includes(timeframe)) {
      return;
    }

    const nextTimeframe = timeframes.includes("1d") ? "1d" : timeframes[0];
    dispatch({
      type: "timeframeChanged",
      timeframe: nextTimeframe,
      range: defaultRangeForTimeframe(nextTimeframe),
    });
  }, [selectedSymbol, timeframe, timeframes]);

  // Remember the last fully-loaded window so timeframe switches can keep the
  // previous candles on screen while the next window loads.
  useEffect(() => {
    if (!display.candleDataCurrent || !candleWindow || !selectedTicker) {
      return;
    }

    lastChartDisplayRef.current = {
      ticker: selectedTicker,
      timeframe,
      startMs: candleWindow.startMs,
      endMs: candleWindow.endMs,
    };
  }, [display.candleDataCurrent, candleWindow, selectedTicker, timeframe]);

  useChartDataLoading({
    selectedTicker,
    timeframe,
    range,
    candleRequestWindow,
    indicatorRequestKey,
    indicatorRequestSpecs,
    dispatch,
    onError,
  });

  /**
   * Applies the stored per-ticker chart state (mode, timeframe, range,
   * indicators). Without stored state the indicators reset so each chart owns
   * its own configuration; a stored timeframe the symbol no longer covers
   * falls back to whatever is currently selected.
   */
  const restoreChartState = useCallback((symbol: SymbolSummary) => {
    const stored = loadChartState(symbol.ticker);
    dispatch({
      type: "chartStateRestored",
      stored,
      timeframeAllowed: stored != null && availableTimeframes(symbol).includes(stored.timeframe),
    });
  }, []);

  /** Defaults the timeframe/range for a newly selected symbol, then restores its stored state. */
  const prepareForSymbol = useCallback(
    (symbol: SymbolSummary) => {
      const nextTimeframes = availableTimeframes(symbol);
      const nextTimeframe = nextTimeframes.includes("1d") ? "1d" : nextTimeframes[0] ?? "1d";
      dispatch({
        type: "timeframeChanged",
        timeframe: nextTimeframe,
        range: defaultRangeForTimeframe(nextTimeframe),
      });
      restoreChartState(symbol);
    },
    [restoreChartState],
  );

  const clearCandleData = useCallback(() => dispatch({ type: "candleDataCleared" }), []);

  function handleTimeframeChange(value: string) {
    if (!value || value === timeframe) {
      return;
    }

    dispatch({ type: "timeframeChanged", timeframe: value, range: defaultRangeForTimeframe(value) });
  }

  function handleRangeChange(value: string) {
    if (!value) {
      return;
    }

    dispatch({
      type: "rangeChanged",
      timeframe: timeframeForRange(selectedSymbol, value, timeframe, timeframes),
      range: value,
    });
  }

  function updateIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    const indicator = activeIndicators.find((candidate) => candidate.id === id);
    const definition = indicator ? indicatorDefinitionsByKind.get(indicator.kind) : undefined;
    dispatch({
      type: "indicatorStyleChanged",
      id,
      slotIndex,
      slotCount: definition ? definitionValueSlots(definition).length : slotIndex + 1,
      patch,
    });
  }

  const handleVisibleCandlesChange = useCallback(
    (candles: Candle[]) => dispatch({ type: "visibleCandlesChanged", candles }),
    [],
  );
  const handleHoverCandleChange = useCallback(
    (candle: Candle | null) => dispatch({ type: "hoverChanged", candle }),
    [],
  );

  return {
    chartMode,
    timeframe,
    range,
    timeframes,
    activeIndicators,
    indicatorPickerOpen: state.indicatorPickerOpen,
    candlesLoading: state.candlesLoading,
    indicatorSeries: state.indicatorSeries,
    indicatorsLoading: state.indicatorsLoading,
    candleRequestWindow,
    chartCandles: display.chartCandles,
    chartTimeframe: display.chartTimeframe,
    chartCandleWindow: display.chartCandleWindow,
    indicatorsForChart,
    ...summary,
    setChartMode: (mode: ChartMode) => dispatch({ type: "modeChanged", mode }),
    openIndicatorPicker: () => dispatch({ type: "pickerToggled", open: true }),
    closeIndicatorPicker: () => dispatch({ type: "pickerToggled", open: false }),
    addIndicator: (definition: IndicatorDefinition) =>
      dispatch({ type: "indicatorAdded", id: createIndicatorId(definition.kind), definition }),
    removeIndicator: (id: string) => dispatch({ type: "indicatorRemoved", id }),
    updateIndicatorParameter: (
      id: string,
      parameter: IndicatorParameterDefinition,
      value: number,
    ) => dispatch({ type: "indicatorParameterChanged", id, key: parameter.key, value }),
    updateIndicatorLineStyle,
    handleTimeframeChange,
    handleRangeChange,
    restoreChartState,
    prepareForSymbol,
    clearCandleData,
    handleVisibleCandlesChange,
    handleHoverCandleChange,
  };
}
