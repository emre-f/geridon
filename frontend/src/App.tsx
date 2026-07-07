import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createStrategy,
  deleteSymbol,
  deleteStrategy,
  generateSignals,
  listIndicatorCatalog,
  listCandles,
  listIndicators,
  listStrategies,
  listSymbols,
  syncCandles,
  updateStrategy,
  validateSymbol,
  validateStrategy,
  type Candle,
  type IndicatorDefinition,
  type IndicatorKind,
  type IndicatorLineStyle,
  type IndicatorParameterDefinition,
  type IndicatorSpec,
  type IndicatorSeries,
  type StrategyDraft,
  type StrategyRecord,
  type StrategySignal,
  type StrategyValidationResult,
  type SymbolSummary,
} from "@/lib/api";
import type { AppTab, SymbolContextMenu } from "@/lib/app-types";
import { formatDate } from "@/lib/format";
import {
  availableTimeframes,
  coverageWindow,
  defaultRangeForTimeframe,
  queryWindow,
  timeframeForRange,
} from "@/lib/chart-options";
import {
  loadChartState,
  loadLastStrategySelection,
  loadLastTicker,
  pullChartStates,
  removeChartState,
  saveChartState,
  saveLastStrategySelection,
  saveLastTicker,
} from "@/lib/chart-state";
import {
  defaultLineStyle,
  definitionValueSlots,
  normalizeLineStyles,
} from "@/lib/indicator-style";
import { createStrategyDraft, strategyIndicatorSpecs } from "@/lib/strategy";
import { draftFromRecord, sameDraft } from "@/lib/strategy-draft";
import { AppHeader } from "@/components/app-header";
import { BacktestPanel } from "@/components/backtest-panel";
import { ChartPanel } from "@/components/chart-panel";
import { IndicatorPicker } from "@/components/indicator-picker";
import { StrategyBuilder } from "@/components/strategy-builder";
import { SymbolContextMenu as SymbolContextMenuView } from "@/components/symbol-context-menu";
import { SymbolSidebar } from "@/components/symbol-sidebar";
import type { ChartMode, ChartTone } from "@/components/stock-chart";
import { Card, CardContent } from "@/components/ui/card";
import { useThemeMode } from "@/hooks/use-theme-mode";

const defaultTicker = "SPY";
const visibleSymbolLimit = 80;
const maxActiveIndicators = 6;

// Stable empty fallbacks: a fresh [] each render would retrigger the chart's
// candles/signals effects and loop setState before any data has loaded.
const noCandles: Candle[] = [];
const noSignals: StrategySignal[] = [];

interface CandleData {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  candles: Candle[];
}

function defaultSymbol(symbols: SymbolSummary[]) {
  return symbols.find((symbol) => symbol.ticker === defaultTicker) ?? symbols[0];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defaultIndicatorParameters(definition: IndicatorDefinition) {
  return Object.fromEntries(
    definition.parameters.map((parameter) => [parameter.key, parameter.default_value]),
  );
}

function createIndicatorId(kind: IndicatorKind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const { setTheme, isDark } = useThemeMode();
  const [activeTab, setActiveTab] = useState<AppTab>("charts");
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [addTickerInput, setAddTickerInput] = useState("");
  const [timeframe, setTimeframe] = useState("1d");
  const [range, setRange] = useState(defaultRangeForTimeframe("1d"));
  const [candleData, setCandleData] = useState<CandleData | null>(null);
  const [visibleCandles, setVisibleCandles] = useState<Candle[]>([]);
  const [indicatorCatalog, setIndicatorCatalog] = useState<IndicatorDefinition[]>([]);
  const [indicatorPickerOpen, setIndicatorPickerOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorSpec[]>([]);
  const [indicatorSeries, setIndicatorSeries] = useState<IndicatorSeries[]>([]);
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [strategyDraft, setStrategyDraft] = useState<StrategyDraft | null>(null);
  const [strategyValidation, setStrategyValidation] = useState<StrategyValidationResult | null>(null);
  const [lastValidStrategyDraft, setLastValidStrategyDraft] = useState<StrategyDraft | null>(null);
  const [strategyPreviewSpecs, setStrategyPreviewSpecs] = useState<IndicatorSpec[]>([]);
  const [strategyIndicatorSeries, setStrategyIndicatorSeries] = useState<IndicatorSeries[]>([]);
  const [strategySignals, setStrategySignals] = useState<StrategySignal[]>([]);
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [indicatorsLoading, setIndicatorsLoading] = useState(false);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategyInitialized, setStrategyInitialized] = useState(false);
  const [strategyIndicatorsLoading, setStrategyIndicatorsLoading] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyValidating, setStrategyValidating] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [deletingTicker, setDeletingTicker] = useState<string | null>(null);
  const [symbolContextMenu, setSymbolContextMenu] = useState<SymbolContextMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const addPanelRef = useRef<HTMLDivElement | null>(null);
  const addTickerInputRef = useRef<HTMLInputElement | null>(null);
  const lastChartDisplayRef = useRef<{
    ticker: string;
    timeframe: string;
    startMs: number;
    endMs: number;
  } | null>(null);

  const selectedSymbol = useMemo(
    () => symbols.find((symbol) => symbol.ticker === selectedTicker),
    [selectedTicker, symbols],
  );
  const filteredSymbols = useMemo(() => {
    const normalized = symbolFilter.toUpperCase().trim();

    if (!normalized) {
      return symbols;
    }

    return symbols.filter((symbol) => symbol.ticker.includes(normalized));
  }, [symbolFilter, symbols]);
  const visibleSymbols = filteredSymbols.slice(0, visibleSymbolLimit);
  const timeframes = useMemo(() => availableTimeframes(selectedSymbol), [selectedSymbol]);
  const indicatorDefinitionsByKind = useMemo(
    () => new Map(indicatorCatalog.map((definition) => [definition.kind, definition])),
    [indicatorCatalog],
  );
  const candleWindow = useMemo(
    () => queryWindow(selectedSymbol, timeframe, range),
    [range, selectedSymbol, timeframe],
  );
  const candleRequestWindow = useMemo(
    () => coverageWindow(selectedSymbol, timeframe),
    [selectedSymbol, timeframe],
  );
  const candleDataCurrent =
    candleData != null &&
    candleRequestWindow != null &&
    candleData.ticker === selectedTicker &&
    candleData.timeframe === timeframe &&
    candleData.startMs === candleRequestWindow.startMs &&
    candleData.endMs === candleRequestWindow.endMs;
  const canShowPendingTimeframeCandles =
    candleData != null && candleData.ticker === selectedTicker && !candleDataCurrent;
  const staleChartDisplay =
    canShowPendingTimeframeCandles && lastChartDisplayRef.current?.ticker === selectedTicker
      ? lastChartDisplayRef.current
      : null;
  const chartCandles =
    candleDataCurrent || canShowPendingTimeframeCandles ? candleData?.candles ?? noCandles : noCandles;
  const chartTimeframe =
    candleDataCurrent
      ? timeframe
      : canShowPendingTimeframeCandles
        ? staleChartDisplay?.timeframe ?? candleData?.timeframe ?? timeframe
        : timeframe;
  const chartCandleWindow =
    candleDataCurrent && candleWindow
      ? candleWindow
      : staleChartDisplay
        ? { startMs: staleChartDisplay.startMs, endMs: staleChartDisplay.endMs }
        : undefined;
  const indicatorRequestKey = useMemo(
    () =>
      JSON.stringify(
        activeIndicators.map(({ id, kind, parameters }) => ({
          id,
          kind,
          parameters,
        })),
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

    return indicatorSeries.map((series) => ({
      ...series,
      styles: normalizeLineStyles(
        stylesById.get(series.id),
        series.values.length,
        specIndexById.get(series.id) ?? 0,
      ),
    }));
  }, [activeIndicators, indicatorSeries]);
  const selectedStrategyRecord = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId),
    [selectedStrategyId, strategies],
  );
  const strategyDirty = useMemo(() => {
    if (!strategyDraft) {
      return false;
    }
    if (!selectedStrategyRecord) {
      // A pristine (New) draft is not worth warning about; only edits are.
      return !sameDraft(strategyDraft, createStrategyDraft(indicatorCatalog));
    }

    return !sameDraft(strategyDraft, draftFromRecord(selectedStrategyRecord));
  }, [indicatorCatalog, selectedStrategyRecord, strategyDraft]);
  const strategyPreviewKey = useMemo(
    () =>
      JSON.stringify(
        strategyPreviewSpecs.map(({ id, kind, parameters }) => ({
          id,
          kind,
          parameters,
        })),
      ),
    [strategyPreviewSpecs],
  );
  const strategyPreviewRequestSpecs = useMemo(
    () => JSON.parse(strategyPreviewKey) as IndicatorSpec[],
    [strategyPreviewKey],
  );
  const strategyIndicatorsForChart = useMemo(() => {
    const specIndexById = new Map(strategyPreviewSpecs.map((indicator, index) => [indicator.id, index]));
    const stylesById = new Map(strategyPreviewSpecs.map((indicator) => [indicator.id, indicator.styles]));

    return strategyIndicatorSeries.map((series) => ({
      ...series,
      styles: normalizeLineStyles(
        stylesById.get(series.id),
        series.values.length,
        specIndexById.get(series.id) ?? 0,
      ),
    }));
  }, [strategyIndicatorSeries, strategyPreviewSpecs]);
  const chartIndicators = activeTab === "strategies" ? strategyIndicatorsForChart : indicatorsForChart;
  const chartSignals = activeTab === "strategies" ? strategySignals : noSignals;

  const summaryCandles =
    visibleCandles.length > 0 && chartCandles.length > 0 ? visibleCandles : chartCandles;
  const latest = summaryCandles.at(-1);
  const first = summaryCandles.at(0);
  const rangeChange = latest && first ? latest.close - first.close : 0;
  const rangePercent = latest && first ? (rangeChange / first.close) * 100 : 0;
  const chartTone: ChartTone = rangeChange < 0 ? "down" : "up";
  const hasPriceSummary = Boolean(latest && first);
  const visibleWindowLabel =
    visibleCandles.length > 0
      ? `${formatDate(visibleCandles[0].timestamp_ms, timeframe)} - ${formatDate(visibleCandles.at(-1)!.timestamp_ms, timeframe)}`
      : candleWindow
        ? `${formatDate(candleWindow.startMs, timeframe)} - ${formatDate(candleWindow.endMs, timeframe)}`
        : null;
  useEffect(() => {
    if (!selectedTicker) {
      return;
    }

    saveLastTicker(selectedTicker);
  }, [selectedTicker]);

  useEffect(() => {
    if (!selectedTicker || activeTab !== "charts") {
      return;
    }

    saveChartState(selectedTicker, {
      chartMode,
      timeframe,
      range,
      indicators: activeIndicators,
    });
  }, [activeIndicators, activeTab, chartMode, range, selectedTicker, timeframe]);

  useEffect(() => {
    let cancelled = false;

    async function loadIndicatorCatalog() {
      try {
        const catalog = await listIndicatorCatalog();
        if (cancelled) {
          return;
        }

        setIndicatorCatalog(catalog);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load indicators.");
        }
      }
    }

    loadIndicatorCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedStrategies() {
      try {
        const records = await listStrategies();
        if (!cancelled) {
          setStrategies(records);
        }
      } catch (loadError) {
        if (!cancelled) {
          setStrategyError(loadError instanceof Error ? loadError.message : "Could not load strategies.");
        }
      } finally {
        if (!cancelled) {
          setStrategiesLoading(false);
        }
      }
    }

    loadSavedStrategies();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (strategyInitialized || strategiesLoading || indicatorCatalog.length === 0) {
      return;
    }

    const remembered = loadLastStrategySelection();
    const rememberedRecord =
      remembered === "new"
        ? undefined
        : strategies.find((strategy) => strategy.id === Number(remembered));

    if (rememberedRecord) {
      const nextDraft = draftFromRecord(rememberedRecord);
      setSelectedStrategyId(rememberedRecord.id);
      setStrategyDraft(nextDraft);
      setLastValidStrategyDraft(nextDraft);
      applyStrategyPreviewSpecs(strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind));
    } else {
      const nextDraft = createStrategyDraft(indicatorCatalog);
      setSelectedStrategyId(null);
      setStrategyDraft(nextDraft);
      setLastValidStrategyDraft(nextDraft);
      applyStrategyPreviewSpecs(strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind));
    }
    setStrategyInitialized(true);
  }, [indicatorCatalog, indicatorDefinitionsByKind, strategies, strategiesLoading, strategyInitialized]);

  /**
   * Applies the stored per-ticker chart state (mode, timeframe, range,
   * indicators). Without stored state the indicators reset so each chart owns
   * its own configuration; a stored timeframe the symbol no longer covers
   * falls back to whatever is currently selected.
   */
  function restoreChartState(symbol: SymbolSummary) {
    const stored = loadChartState(symbol.ticker);
    setActiveIndicators(stored?.indicators ?? []);

    if (!stored) {
      return;
    }

    setChartMode(stored.chartMode);
    if (availableTimeframes(symbol).includes(stored.timeframe)) {
      setTimeframe(stored.timeframe);
      setRange(stored.range);
    }
  }

  async function loadSymbolList(preferredTicker?: string) {
    const nextSymbols = await listSymbols();
    setSymbols(nextSymbols);

    const nextSymbol =
      (preferredTicker
        ? nextSymbols.find((symbol) => symbol.ticker === preferredTicker)
        : undefined) ??
      nextSymbols.find((symbol) => symbol.ticker === selectedTicker) ??
      defaultSymbol(nextSymbols);

    if (nextSymbol) {
      setSelectedTicker(nextSymbol.ticker);
      const nextTimeframes = availableTimeframes(nextSymbol);
      const nextTimeframe = nextTimeframes.includes("1d") ? "1d" : nextTimeframes[0] ?? "1d";
      setTimeframe(nextTimeframe);
      setRange(defaultRangeForTimeframe(nextTimeframe));
      restoreChartState(nextSymbol);
    } else {
      setSelectedTicker("");
      setCandleData(null);
    }

    return nextSymbols;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSymbols() {
      setSymbolsLoading(true);
      setError(null);

      try {
        // Merge chart states stored in the backend DB into localStorage first
        // so restoreChartState picks them up even after a storage wipe.
        const [nextSymbols] = await Promise.all([listSymbols(), pullChartStates()]);
        if (cancelled) {
          return;
        }

        setSymbols(nextSymbols);
        const lastTicker = loadLastTicker();
        const nextDefaultSymbol =
          (lastTicker
            ? nextSymbols.find((symbol) => symbol.ticker === lastTicker)
            : undefined) ?? defaultSymbol(nextSymbols);
        if (nextDefaultSymbol) {
          setSelectedTicker(nextDefaultSymbol.ticker);
          const nextTimeframes = availableTimeframes(nextDefaultSymbol);
          const nextTimeframe = nextTimeframes.includes("1d") ? "1d" : nextTimeframes[0];
          setTimeframe(nextTimeframe);
          setRange(defaultRangeForTimeframe(nextTimeframe));
          restoreChartState(nextDefaultSymbol);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load symbols.");
        }
      } finally {
        if (!cancelled) {
          setSymbolsLoading(false);
        }
      }
    }

    loadSymbols();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSymbol || timeframes.length === 0) {
      return;
    }

    if (!timeframes.includes(timeframe)) {
      const nextTimeframe = timeframes.includes("1d") ? "1d" : timeframes[0];
      setTimeframe(nextTimeframe);
      setRange(defaultRangeForTimeframe(nextTimeframe));
    }
  }, [selectedSymbol, timeframe, timeframes]);

  useEffect(() => {
    if (!selectedTicker || !candleRequestWindow) {
      setCandleData(null);
      setVisibleCandles([]);
      setIndicatorSeries([]);
      return;
    }

    let cancelled = false;
    const requestTicker = selectedTicker;
    const requestTimeframe = timeframe;
    const requestWindow = candleRequestWindow;

    async function loadCandles() {
      setCandlesLoading(true);
      setError(null);

      try {
        const nextCandles = await listCandles({
          ticker: requestTicker,
          timeframe: requestTimeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
        });

        if (!cancelled) {
          setCandleData({
            ticker: requestTicker,
            timeframe: requestTimeframe,
            startMs: requestWindow.startMs,
            endMs: requestWindow.endMs,
            candles: nextCandles,
          });
          setVisibleCandles([]);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCandleData(null);
          setVisibleCandles([]);
          setError(loadError instanceof Error ? loadError.message : "Could not load candles.");
        }
      } finally {
        if (!cancelled) {
          setCandlesLoading(false);
        }
      }
    }

    loadCandles();
    return () => {
      cancelled = true;
    };
  }, [selectedTicker, timeframe, candleRequestWindow]);

  useEffect(() => {
    if (!selectedTicker || !candleRequestWindow || indicatorRequestSpecs.length === 0) {
      setIndicatorSeries([]);
      setIndicatorsLoading(false);
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;

    async function loadIndicators() {
      setIndicatorsLoading(true);
      setError(null);

      try {
        const nextSeries = await listIndicators({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          indicators: indicatorRequestSpecs,
        });

        if (!cancelled) {
          setIndicatorSeries(nextSeries);
        }
      } catch (loadError) {
        if (!cancelled) {
          setIndicatorSeries([]);
          setError(loadError instanceof Error ? loadError.message : "Could not load indicators.");
        }
      } finally {
        if (!cancelled) {
          setIndicatorsLoading(false);
        }
      }
    }

    loadIndicators();
    return () => {
      cancelled = true;
    };
  }, [candleRequestWindow, indicatorRequestKey, indicatorRequestSpecs, selectedTicker, timeframe]);

  useEffect(() => {
    if (activeTab !== "strategies" || !strategyDraft || indicatorCatalog.length === 0) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setStrategyValidating(true);
      setStrategyError(null);

      try {
        const result = await validateStrategy(strategyDraft);
        if (cancelled) {
          return;
        }

        setStrategyValidation(result);
        if (result.valid) {
          setLastValidStrategyDraft(strategyDraft);
          applyStrategyPreviewSpecs(strategyIndicatorSpecs(strategyDraft, indicatorDefinitionsByKind));
        }
      } catch (validateError) {
        if (!cancelled) {
          setStrategyError(
            validateError instanceof Error ? validateError.message : "Could not validate the strategy.",
          );
        }
      } finally {
        if (!cancelled) {
          setStrategyValidating(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeTab, indicatorCatalog.length, indicatorDefinitionsByKind, strategyDraft]);

  useEffect(() => {
    if (
      activeTab !== "strategies" ||
      !selectedTicker ||
      !candleRequestWindow ||
      strategyPreviewRequestSpecs.length === 0
    ) {
      setStrategyIndicatorSeries([]);
      setStrategyIndicatorsLoading(false);
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;

    async function loadStrategyIndicators() {
      setStrategyIndicatorsLoading(true);
      setStrategyError(null);

      try {
        const nextSeries = await listIndicators({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          indicators: strategyPreviewRequestSpecs,
        });

        if (!cancelled) {
          setStrategyIndicatorSeries(nextSeries);
        }
      } catch (loadError) {
        if (!cancelled) {
          setStrategyIndicatorSeries([]);
          setStrategyError(loadError instanceof Error ? loadError.message : "Could not load strategy indicators.");
        }
      } finally {
        if (!cancelled) {
          setStrategyIndicatorsLoading(false);
        }
      }
    }

    loadStrategyIndicators();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    candleRequestWindow,
    selectedTicker,
    strategyPreviewKey,
    strategyPreviewRequestSpecs,
    timeframe,
  ]);

  useEffect(() => {
    setStrategySignals([]);

    if (activeTab !== "strategies" || !selectedTicker || !candleRequestWindow || !lastValidStrategyDraft) {
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;
    const requestStrategy = lastValidStrategyDraft;

    async function loadSignals() {
      try {
        const response = await generateSignals({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
          strategy: requestStrategy,
        });

        if (!cancelled) {
          setStrategySignals(response.signals);
        }
      } catch (signalError) {
        if (!cancelled) {
          setStrategyError(signalError instanceof Error ? signalError.message : "Could not generate signals.");
        }
      }
    }

    loadSignals();
    return () => {
      cancelled = true;
    };
  }, [activeTab, candleRequestWindow, lastValidStrategyDraft, selectedTicker, timeframe]);

  useEffect(() => {
    if (!strategyDirty) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [strategyDirty]);

  useEffect(() => {
    if (activeTab !== "charts") {
      setIndicatorPickerOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!candleDataCurrent || !candleWindow || !selectedTicker) {
      return;
    }

    lastChartDisplayRef.current = {
      ticker: selectedTicker,
      timeframe,
      startMs: candleWindow.startMs,
      endMs: candleWindow.endMs,
    };
  }, [candleDataCurrent, candleWindow, selectedTicker, timeframe]);

  useEffect(() => {
    setVisibleCandles([]);
  }, [range, selectedTicker, timeframe]);

  const handleVisibleCandlesChange = useCallback((nextVisibleCandles: Candle[]) => {
    // Keep the empty-state identity stable so the chart's notify effect can't
    // ping-pong renders with this component.
    setVisibleCandles((current) =>
      current.length === 0 && nextVisibleCandles.length === 0 ? current : nextVisibleCandles,
    );
  }, []);

  const handleHoverCandleChange = useCallback((nextHoverCandle: Candle | null) => {
    setHoverCandle(nextHoverCandle);
  }, []);

  // Legend values track the hovered candle; without a hover they show the
  // newest candle in view.
  const legendTimestampMs = (hoverCandle ?? summaryCandles.at(-1))?.timestamp_ms ?? null;

  useEffect(() => {
    if (!addPanelOpen) {
      return;
    }

    addTickerInputRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        addPanelRef.current &&
        !addPanelRef.current.contains(event.target)
      ) {
        setAddPanelOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddPanelOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addPanelOpen]);

  useEffect(() => {
    if (!symbolContextMenu) {
      return;
    }

    function closeContextMenu() {
      setSymbolContextMenu(null);
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSymbolContextMenu(null);
      }
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuOnEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
    };
  }, [symbolContextMenu]);

  function confirmDiscardStrategyChanges() {
    return !strategyDirty || window.confirm("You have unsaved changes — discard them?");
  }

  function resetCurrentStrategyDraft() {
    if (selectedStrategyRecord) {
      setStrategyDraft(draftFromRecord(selectedStrategyRecord));
      return;
    }

    if (indicatorCatalog.length > 0) {
      setStrategyDraft(createStrategyDraft(indicatorCatalog));
    }
  }

  function handleTabChange(value: string) {
    if (!value || value === activeTab) {
      return;
    }

    if (activeTab === "strategies") {
      if (!confirmDiscardStrategyChanges()) {
        return;
      }
      resetCurrentStrategyDraft();
      setStrategyValidation(null);
      setStrategyError(null);
    }

    setActiveTab(value as AppTab);
  }

  function openStrategyRecord(record: StrategyRecord) {
    const nextDraft = draftFromRecord(record);
    setSelectedStrategyId(record.id);
    setStrategyDraft(nextDraft);
    setStrategyValidation(null);
    setStrategyError(null);
    setLastValidStrategyDraft(nextDraft);
    applyStrategyPreviewSpecs(strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind));
    setStrategySignals([]);
    saveLastStrategySelection(String(record.id));
  }

  function openNewStrategy() {
    const nextDraft = createStrategyDraft(indicatorCatalog);
    setSelectedStrategyId(null);
    setStrategyDraft(nextDraft);
    setStrategyValidation(null);
    setStrategyError(null);
    setLastValidStrategyDraft(nextDraft);
    applyStrategyPreviewSpecs(strategyIndicatorSpecs(nextDraft, indicatorDefinitionsByKind));
    setStrategySignals([]);
    saveLastStrategySelection("new");
  }

  function handleStrategySelect(value: string) {
    if (!confirmDiscardStrategyChanges()) {
      return;
    }

    if (value === "new") {
      openNewStrategy();
      return;
    }

    const record = strategies.find((strategy) => strategy.id === Number(value));
    if (record) {
      openStrategyRecord(record);
    }
  }

  /**
   * Turns the current draft (including unsaved edits) into a new unsaved
   * strategy, leaving the stored original untouched. Saving then creates a
   * separate record.
   */
  function handleStrategyDuplicate() {
    if (!strategyDraft) {
      return;
    }

    const suffix = " (copy)";
    const base = strategyDraft.name.trim().slice(0, 80 - suffix.length);
    setSelectedStrategyId(null);
    setStrategyDraft({ ...strategyDraft, name: `${base}${suffix}` });
    setStrategyValidation(null);
    setStrategyError(null);
    saveLastStrategySelection("new");
  }

  function handleStrategyDraftChange(nextDraft: StrategyDraft) {
    setStrategyDraft(nextDraft);
    setStrategyValidation(null);
    setStrategyError(null);
  }

  async function handleStrategyValidate() {
    if (!strategyDraft) {
      return null;
    }

    setStrategyValidating(true);
    setStrategyError(null);
    try {
      const result = await validateStrategy(strategyDraft);
      setStrategyValidation(result);
      if (result.valid) {
        setLastValidStrategyDraft(strategyDraft);
        applyStrategyPreviewSpecs(strategyIndicatorSpecs(strategyDraft, indicatorDefinitionsByKind));
      }
      return result;
    } catch (validateError) {
      setStrategyError(
        validateError instanceof Error ? validateError.message : "Could not validate the strategy.",
      );
      return null;
    } finally {
      setStrategyValidating(false);
    }
  }

  async function handleStrategySave() {
    if (!strategyDraft) {
      return;
    }

    const result = await handleStrategyValidate();
    if (!result?.valid) {
      return;
    }

    setStrategySaving(true);
    setStrategyError(null);
    try {
      const record =
        selectedStrategyId == null
          ? await createStrategy(strategyDraft)
          : await updateStrategy(selectedStrategyId, strategyDraft);
      setStrategies((current) => {
        const others = current.filter((strategy) => strategy.id !== record.id);
        return [...others, record].sort(
          (left, right) => left.name.localeCompare(right.name) || left.id - right.id,
        );
      });
      openStrategyRecord(record);
      setStrategyValidation(result);
    } catch (saveError) {
      setStrategyError(saveError instanceof Error ? saveError.message : "Could not save the strategy.");
    } finally {
      setStrategySaving(false);
    }
  }

  async function handleStrategyDelete() {
    if (selectedStrategyId == null) {
      return;
    }

    const record = strategies.find((strategy) => strategy.id === selectedStrategyId);
    if (!window.confirm(`Delete strategy "${record?.name ?? selectedStrategyId}"?`)) {
      return;
    }

    setStrategyError(null);
    try {
      await deleteStrategy(selectedStrategyId);
      const remaining = strategies.filter((strategy) => strategy.id !== selectedStrategyId);
      setStrategies(remaining);
      openNewStrategy();
    } catch (deleteError) {
      setStrategyError(deleteError instanceof Error ? deleteError.message : "Could not delete the strategy.");
    }
  }

  function selectSymbol(symbol: SymbolSummary) {
    if (symbol.ticker !== selectedTicker) {
      restoreChartState(symbol);
    }
    setSelectedTicker(symbol.ticker);
    setError(null);
    setSymbolContextMenu(null);
  }

  function openSymbolContextMenu(event: MouseEvent<HTMLButtonElement>, ticker: string) {
    event.preventDefault();
    const menuWidth = 176;
    const menuHeight = 44;

    setSymbolContextMenu({
      ticker,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  }

  function handleTimeframeChange(value: string) {
    if (!value || value === timeframe) {
      return;
    }

    setTimeframe(value);
    setRange(defaultRangeForTimeframe(value));
  }

  function handleRangeChange(value: string) {
    if (!value) {
      return;
    }

    const nextTimeframe = timeframeForRange(selectedSymbol, value, timeframe, timeframes);
    setTimeframe(nextTimeframe);
    setRange(value);
  }

  function addIndicator(definition: IndicatorDefinition) {
    setActiveIndicators((currentIndicators) => {
      if (currentIndicators.length >= maxActiveIndicators) {
        return currentIndicators;
      }

      return [
        ...currentIndicators,
        {
          id: createIndicatorId(definition.kind),
          kind: definition.kind,
          parameters: defaultIndicatorParameters(definition),
          styles: definitionValueSlots(definition).map((_, slotIndex) =>
            defaultLineStyle(currentIndicators.length + slotIndex),
          ),
        },
      ];
    });
  }

  function removeIndicator(id: string) {
    setActiveIndicators((currentIndicators) =>
      currentIndicators.filter((indicator) => indicator.id !== id),
    );
  }

  function updateIndicatorParameter(
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) {
    setActiveIndicators((currentIndicators) =>
      currentIndicators.map((indicator) => {
        if (indicator.id !== id) {
          return indicator;
        }

        const nextParameters = {
          ...indicator.parameters,
          [parameter.key]: nextValue,
        };

        if (indicator.kind === "macd") {
          if (parameter.key === "fast" && nextParameters.fast >= nextParameters.slow) {
            if (nextParameters.fast >= 500) {
              nextParameters.fast = 499;
              nextParameters.slow = 500;
            } else {
              nextParameters.slow = clampNumber(nextParameters.fast + 1, 2, 500);
            }
          }
          if (parameter.key === "slow" && nextParameters.slow <= nextParameters.fast) {
            nextParameters.fast = clampNumber(nextParameters.slow - 1, 1, 499);
          }
        }

        return {
          ...indicator,
          parameters: nextParameters,
        };
      }),
    );
  }

  function applyStrategyPreviewSpecs(nextSpecs: IndicatorSpec[]) {
    // Preview specs are rebuilt from the draft on every rule edit; carry over
    // user-chosen line styles. Ids embed the operand index (which shifts as
    // rules change), so match on kind + parameters instead.
    setStrategyPreviewSpecs((previousSpecs) =>
      nextSpecs.map((spec) => {
        const previous = previousSpecs.find(
          (candidate) =>
            candidate.kind === spec.kind &&
            JSON.stringify(candidate.parameters) === JSON.stringify(spec.parameters),
        );

        return previous?.styles ? { ...spec, styles: previous.styles } : spec;
      }),
    );
  }

  function updateStrategyIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    setStrategyPreviewSpecs((currentIndicators) =>
      currentIndicators.map((indicator, indicatorIndex) => {
        if (indicator.id !== id) {
          return indicator;
        }

        const definition = indicatorDefinitionsByKind.get(indicator.kind);
        const slotCount = definition ? definitionValueSlots(definition).length : slotIndex + 1;
        const styles = normalizeLineStyles(
          indicator.styles,
          Math.max(slotCount, slotIndex + 1),
          indicatorIndex,
        );
        styles[slotIndex] = { ...styles[slotIndex], ...patch };

        return {
          ...indicator,
          styles,
        };
      }),
    );
  }

  function updateIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    setActiveIndicators((currentIndicators) =>
      currentIndicators.map((indicator, indicatorIndex) => {
        if (indicator.id !== id) {
          return indicator;
        }

        const definition = indicatorDefinitionsByKind.get(indicator.kind);
        const slotCount = definition ? definitionValueSlots(definition).length : slotIndex + 1;
        const styles = normalizeLineStyles(
          indicator.styles,
          Math.max(slotCount, slotIndex + 1),
          indicatorIndex,
        );
        styles[slotIndex] = { ...styles[slotIndex], ...patch };

        return {
          ...indicator,
          styles,
        };
      }),
    );
  }

  async function handleDeleteSymbol(ticker: string) {
    const confirmed = window.confirm(`Delete ${ticker} and all related candle data?`);
    if (!confirmed) {
      setSymbolContextMenu(null);
      return;
    }

    setDeletingTicker(ticker);
    setSymbolContextMenu(null);
    setError(null);

    try {
      await deleteSymbol(ticker);
      removeChartState(ticker);
      await loadSymbolList();
      if (ticker === selectedTicker) {
        setCandleData(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Could not delete ${ticker}.`);
    } finally {
      setDeletingTicker(null);
    }
  }

  async function handleAddSymbolSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = addTickerInput.toUpperCase().trim();

    if (!normalized) {
      setError("Enter a ticker to add.");
      return;
    }

    const exactMatch = symbols.find((symbol) => symbol.ticker === normalized);
    if (exactMatch) {
      selectSymbol(exactMatch);
      setAddTickerInput("");
      setAddPanelOpen(false);
      return;
    }

    setAddingSymbol(true);
    setError(null);

    try {
      const validation = await validateSymbol(normalized);
      if (!validation.valid) {
        throw new Error(`No Yahoo Finance data found for ${normalized}.`);
      }

      const end = new Date();
      const dailyStart = new Date(end);
      dailyStart.setUTCFullYear(dailyStart.getUTCFullYear() - 5);
      const hourlyStart = new Date(end);
      hourlyStart.setUTCFullYear(hourlyStart.getUTCFullYear() - 1);

      const dailyResult = await syncCandles({
        ticker: normalized,
        timeframe: "1d",
        start: dailyStart.toISOString(),
        end: end.toISOString(),
      });

      if (dailyResult.candles_received === 0 && dailyResult.candles_inserted === 0) {
        throw new Error(`No Yahoo Finance candles returned for ${normalized}.`);
      }

      await syncCandles({
        ticker: normalized,
        timeframe: "1h",
        start: hourlyStart.toISOString(),
        end: end.toISOString(),
      }).catch(() => null);

      const nextSymbols = await loadSymbolList(normalized);
      const addedSymbol = nextSymbols.find((symbol) => symbol.ticker === normalized);
      if (!addedSymbol) {
        throw new Error(`Could not add ${normalized} to stored symbols.`);
      }

      setAddTickerInput("");
      setAddPanelOpen(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : `Could not add ${normalized}.`);
    } finally {
      setAddingSymbol(false);
    }
  }

  function refresh() {
    if (!selectedTicker) {
      return;
    }
    const ticker = selectedTicker;
    setSelectedTicker("");
    globalThis.requestAnimationFrame(() => setSelectedTicker(ticker));
  }

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="flex w-full flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5 2xl:px-6">
        <AppHeader
          activeTab={activeTab}
          isDark={isDark}
          onRefresh={refresh}
          onTabChange={handleTabChange}
          onThemeChange={() => setTheme(isDark ? "light" : "dark")}
        />

        {error ? (
          <Card className="border-destructive/40 bg-destructive/5 py-4">
            <CardContent className="text-destructive text-sm">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {activeTab !== "backtest" ? (
              <ChartPanel
                activeIndicators={activeIndicators}
                activeTab={activeTab}
                candles={chartCandles}
                candlesLoading={candlesLoading}
                candleWindow={chartCandleWindow}
                chartIndicators={chartIndicators}
                chartMode={chartMode}
                chartSignals={chartSignals}
                chartTone={chartTone}
                hasPriceSummary={hasPriceSummary}
                indicatorCatalogLength={indicatorCatalog.length}
                indicatorDefinitionsByKind={indicatorDefinitionsByKind}
                indicatorSeries={indicatorSeries}
                indicatorsLoading={indicatorsLoading}
                latest={latest}
                legendTimestampMs={legendTimestampMs}
                range={range}
                rangeChange={rangeChange}
                rangePercent={rangePercent}
                selectedSymbol={selectedSymbol}
                selectedTicker={selectedTicker}
                strategyIndicatorSeries={strategyIndicatorSeries}
                strategyIndicatorsLoading={strategyIndicatorsLoading}
                strategyPreviewSpecs={strategyPreviewSpecs}
                symbolsLoading={symbolsLoading}
                chartTimeframe={chartTimeframe}
                timeframe={timeframe}
                timeframes={timeframes}
                visibleWindowLabel={visibleWindowLabel}
                onChartModeChange={setChartMode}
                onHoverCandleChange={handleHoverCandleChange}
                onOpenIndicatorPicker={() => setIndicatorPickerOpen(true)}
                onRangeChange={handleRangeChange}
                onRemoveIndicator={removeIndicator}
                onTimeframeChange={handleTimeframeChange}
                onUpdateIndicatorLineStyle={updateIndicatorLineStyle}
                onUpdateIndicatorParameter={updateIndicatorParameter}
                onUpdateStrategyIndicatorLineStyle={updateStrategyIndicatorLineStyle}
                onVisibleCandlesChange={handleVisibleCandlesChange}
              />
            ) : null}

            {activeTab === "strategies" ? (
              <div className="transition-all duration-200 motion-reduce:transition-none">
                <StrategyBuilder
                  catalog={indicatorCatalog}
                  strategies={strategies}
                  selectedId={selectedStrategyId}
                  draft={strategyDraft}
                  dirty={strategyDirty}
                  loading={strategiesLoading || !strategyInitialized}
                  saving={strategySaving}
                  validating={strategyValidating}
                  validation={strategyValidation}
                  error={strategyError}
                  onDraftChange={handleStrategyDraftChange}
                  onSelectStrategy={handleStrategySelect}
                  onDuplicate={handleStrategyDuplicate}
                  onDelete={handleStrategyDelete}
                  onValidate={handleStrategyValidate}
                  onSave={handleStrategySave}
                />
              </div>
            ) : null}

            {/* Kept mounted so the loaded run and comparisons survive tab switches. */}
            <div className={activeTab === "backtest" ? "contents" : "hidden"}>
              <BacktestPanel
                strategies={strategies}
                initialStrategyId={selectedStrategyId}
                strategyDirty={strategyDirty}
                symbols={symbols}
                defaultTicker={selectedTicker}
                definitionsByKind={indicatorDefinitionsByKind}
              />
            </div>
          </div>

          <SymbolSidebar
            addPanelRef={addPanelRef}
            addTickerInputRef={addTickerInputRef}
            addPanelOpen={addPanelOpen}
            addTickerInput={addTickerInput}
            addingSymbol={addingSymbol}
            deletingTicker={deletingTicker}
            filteredSymbols={filteredSymbols}
            selectedTicker={selectedTicker}
            symbolFilter={symbolFilter}
            symbolsLoading={symbolsLoading}
            visibleSymbols={visibleSymbols}
            onAddPanelOpenChange={setAddPanelOpen}
            onAddTickerInputChange={setAddTickerInput}
            onAddSymbolSubmit={handleAddSymbolSubmit}
            onContextMenu={openSymbolContextMenu}
            onSelectSymbol={selectSymbol}
            onSymbolFilterChange={setSymbolFilter}
          />
        </div>
      </div>
      <IndicatorPicker
        open={indicatorPickerOpen}
        catalog={indicatorCatalog}
        activeCount={activeIndicators.length}
        maxCount={maxActiveIndicators}
        onAdd={addIndicator}
        onClose={() => setIndicatorPickerOpen(false)}
      />
      {symbolContextMenu ? (
        <SymbolContextMenuView
          menu={symbolContextMenu}
          deletingTicker={deletingTicker}
          onDelete={handleDeleteSymbol}
        />
      ) : null}
    </main>
  );
}
