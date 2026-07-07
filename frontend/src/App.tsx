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
  ArrowDownIcon,
  ArrowUpIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

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
  type StrategyCondition,
  type StrategyDraft,
  type StrategyRecord,
  type StrategySignal,
  type StrategyValidationResult,
  type SymbolSummary,
} from "@/lib/api";
import {
  formatAbsolutePercent,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
} from "@/lib/format";
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
import { asRootGroup, createStrategyDraft, strategyIndicatorSpecs } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { BacktestPanel } from "@/components/backtest-panel";
import { IndicatorLegend } from "@/components/indicator-legend";
import { IndicatorPicker } from "@/components/indicator-picker";
import { StrategyBuilder } from "@/components/strategy-builder";
import { StockChart, type ChartMode, type ChartTone } from "@/components/stock-chart";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SlashTabs } from "@/components/ui/slash-tabs";

const tabOptions = [
  { value: "charts", label: "Charts" },
  { value: "strategies", label: "Strategies" },
  { value: "backtest", label: "Backtest" },
];

const chartModeOptions = [
  { value: "line", label: "Line" },
  { value: "candle", label: "Candle" },
];

const timeframeOptions = [
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const rangeOptions = [
  { value: "1M", label: "1M", days: 31 },
  { value: "3M", label: "3M", days: 93 },
  { value: "1Y", label: "1Y", days: 366 },
  { value: "5Y", label: "5Y", days: 366 * 5 },
  { value: "MAX", label: "MAX", days: null },
];

const timeframeOrder = ["1h", "4h", "1d"];
const defaultRangeByTimeframe: Record<string, string> = {
  "1h": "3M",
  "4h": "1Y",
  "1d": "5Y",
};
const longRangeValues = new Set(["5Y", "MAX"]);
const coverageTolerance = 0.95;
const themeStorageKey = "geridon-theme";
const defaultTicker = "SPY";
const visibleSymbolLimit = 80;
const maxActiveIndicators = 6;

type Theme = "light" | "dark";
type AppTab = "charts" | "strategies" | "backtest";

interface SymbolContextMenu {
  ticker: string;
  x: number;
  y: number;
}

function storedTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function availableTimeframes(symbol: SymbolSummary | undefined) {
  if (!symbol) {
    return [];
  }

  const stored = new Set(symbol.timeframes.map((timeframe) => timeframe.timeframe));
  const values = new Set<string>();

  if (stored.has("1h")) {
    values.add("1h");
    values.add("4h");
  }
  if (stored.has("1d")) {
    values.add("1d");
  }

  return Array.from(values).sort((left, right) => timeframeOrder.indexOf(left) - timeframeOrder.indexOf(right));
}

function coverageForTimeframe(symbol: SymbolSummary | undefined, timeframe: string) {
  if (!symbol) {
    return undefined;
  }

  const sourceTimeframe = timeframe === "4h" ? "1h" : timeframe;
  return symbol.timeframes.find((item) => item.timeframe === sourceTimeframe);
}

function queryWindow(symbol: SymbolSummary | undefined, timeframe: string, range: string) {
  const coverage = coverageForTimeframe(symbol, timeframe);
  if (!coverage) {
    return undefined;
  }

  const rangeOption = rangeOptions.find((option) => option.value === range) ?? rangeOptions[0];
  const endMs = coverage.end_ms;
  const startMs =
    rangeOption.days == null
      ? coverage.start_ms
      : Math.max(coverage.start_ms, endMs - rangeOption.days * 24 * 60 * 60 * 1000);

  return { startMs, endMs };
}

function coverageWindow(symbol: SymbolSummary | undefined, timeframe: string) {
  const coverage = coverageForTimeframe(symbol, timeframe);
  if (!coverage) {
    return undefined;
  }

  return { startMs: coverage.start_ms, endMs: coverage.end_ms };
}

function defaultSymbol(symbols: SymbolSummary[]) {
  return symbols.find((symbol) => symbol.ticker === defaultTicker) ?? symbols[0];
}

function defaultRangeForTimeframe(timeframe: string) {
  return defaultRangeByTimeframe[timeframe] ?? rangeOptions[0].value;
}

function timeframeCoversRange(symbol: SymbolSummary | undefined, timeframe: string, range: string) {
  const rangeOption = rangeOptions.find((option) => option.value === range);
  const coverage = coverageForTimeframe(symbol, timeframe);

  if (!rangeOption || !coverage) {
    return false;
  }

  if (rangeOption.days == null) {
    return timeframe === "1d";
  }

  return (
    coverage.end_ms - coverage.start_ms >=
    rangeOption.days * 24 * 60 * 60 * 1000 * coverageTolerance
  );
}

function timeframeForRange(
  symbol: SymbolSummary | undefined,
  range: string,
  currentTimeframe: string,
  nextTimeframes: string[],
) {
  if (nextTimeframes.length === 0) {
    return currentTimeframe;
  }

  if (
    !longRangeValues.has(range) &&
    nextTimeframes.includes(currentTimeframe) &&
    timeframeCoversRange(symbol, currentTimeframe, range)
  ) {
    return currentTimeframe;
  }

  const preferences = longRangeValues.has(range)
    ? ["1d", "4h", "1h"]
    : [currentTimeframe, "4h", "1h", "1d"];
  const coveredTimeframe = preferences.find(
    (value) => nextTimeframes.includes(value) && timeframeCoversRange(symbol, value, range),
  );

  return coveredTimeframe ?? (nextTimeframes.includes(currentTimeframe) ? currentTimeframe : nextTimeframes[0]);
}

function formatSignedCompactCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${formatCompactCurrency(value)}`;
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

function draftFromRecord(record: StrategyRecord): StrategyDraft {
  return {
    name: record.name,
    entry: asRootGroup(record.entry),
    exit: asRootGroup(record.exit),
  };
}

function stripConditionIds(condition: StrategyCondition): unknown {
  // Stored records only carry enabled when false, so mirror that here to keep
  // dirty comparisons stable.
  const enabled = condition.enabled === false ? { enabled: false } : {};

  if (condition.type === "group") {
    return {
      type: condition.type,
      operator: condition.operator,
      conditions: condition.conditions.map(stripConditionIds),
      ...enabled,
    };
  }

  return {
    type: condition.type,
    left: condition.left,
    operator: condition.operator,
    right: condition.right,
    ...enabled,
  };
}

function serializableDraft(draft: StrategyDraft) {
  return {
    name: draft.name,
    entry: stripConditionIds(draft.entry),
    exit: stripConditionIds(draft.exit),
  };
}

function sameDraft(left: StrategyDraft | null, right: StrategyDraft | null) {
  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify(serializableDraft(left)) === JSON.stringify(serializableDraft(right));
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [activeTab, setActiveTab] = useState<AppTab>("charts");
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [addTickerInput, setAddTickerInput] = useState("");
  const [timeframe, setTimeframe] = useState("1d");
  const [range, setRange] = useState(defaultRangeForTimeframe("1d"));
  const [candles, setCandles] = useState<Candle[]>([]);
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
  const chartSignals = activeTab === "strategies" ? strategySignals : [];

  const summaryCandles = visibleCandles.length > 0 ? visibleCandles : candles;
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
  const selectedSymbolClass =
    "!bg-[var(--control-selected)] !text-[var(--control-selected-foreground)] hover:!bg-[var(--control-selected-hover)] hover:!text-[var(--control-selected-foreground)]";
  const priceSummaryClass =
    chartTone === "down"
      ? "bg-[var(--chart-down-muted)] text-[var(--chart-down)]"
      : "bg-[var(--chart-up-muted)] text-[var(--chart-up)]";
  const isDark = theme === "dark";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = theme;

    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Ignore storage failures so the toggle still works for the current session.
    }
  }, [isDark, theme]);

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
      setCandles([]);
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
      setCandles([]);
      setVisibleCandles([]);
      setIndicatorSeries([]);
      return;
    }

    let cancelled = false;
    const requestWindow = candleRequestWindow;

    async function loadCandles() {
      setCandlesLoading(true);
      setError(null);

      try {
        const nextCandles = await listCandles({
          ticker: selectedTicker,
          timeframe,
          startMs: requestWindow.startMs,
          endMs: requestWindow.endMs,
        });

        if (!cancelled) {
          setCandles(nextCandles);
          setVisibleCandles([]);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCandles([]);
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
    setVisibleCandles([]);
  }, [range, selectedTicker, timeframe]);

  const handleVisibleCandlesChange = useCallback((nextVisibleCandles: Candle[]) => {
    setVisibleCandles(nextVisibleCandles);
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
        setCandles([]);
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
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="group/title flex min-w-0 items-center whitespace-nowrap">
              <h1 className="text-lg font-semibold leading-none">geridon</h1>
              <span className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 ease-in-out group-hover/title:max-w-72 group-hover/title:opacity-100">
                <span className="text-muted-foreground pl-2 text-sm leading-none">
                  / backtest your trading strategies
                </span>
              </span>
            </div>
            <SlashTabs
              options={tabOptions}
              value={activeTab}
              onValueChange={handleTabChange}
              aria-label="Workspace tab"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Refresh chart"
              onClick={refresh}
            >
              <RefreshCwIcon />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        </header>

        {error ? (
          <Card className="border-destructive/40 bg-destructive/5 py-4">
            <CardContent className="text-destructive text-sm">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {activeTab !== "backtest" ? (
            <Card className="gap-4">
              <CardHeader className="flex flex-col gap-4 px-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  {activeTab === "charts" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIndicatorPickerOpen(true)}
                      disabled={indicatorCatalog.length === 0}
                    >
                      <PlusIcon />
                      Indicators
                    </Button>
                  ) : null}

                  <SlashTabs
                    options={chartModeOptions}
                    value={chartMode}
                    onValueChange={(value) => setChartMode(value as ChartMode)}
                    aria-label="Chart style"
                  />

                  <SlashTabs
                    options={timeframeOptions.map((option) => ({
                      ...option,
                      disabled: !timeframes.includes(option.value),
                    }))}
                    value={timeframe}
                    onValueChange={handleTimeframeChange}
                    aria-label="Candle timeframe"
                  />

                  <SlashTabs
                    options={rangeOptions}
                    value={range}
                    onValueChange={handleRangeChange}
                    aria-label="Visible range"
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 items-center gap-3 whitespace-nowrap">
                    <CardTitle className="shrink-0 text-xl">
                      {selectedTicker || "No symbol selected"}
                    </CardTitle>
                    {symbolsLoading || candlesLoading ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="shrink-0 select-none text-xl text-muted-foreground/50"
                        >
                          /
                        </span>
                        <Skeleton className="h-8 w-full max-w-[28rem]" />
                      </>
                    ) : hasPriceSummary && latest ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="shrink-0 select-none text-xl text-muted-foreground/50"
                        >
                          /
                        </span>
                      <div className="shrink-0 text-[clamp(1.5rem,4vw,1.875rem)] font-medium leading-none tracking-normal text-foreground">
                        {formatCurrency(latest.close)}
                      </div>
                      <div
                        className={cn(
                          "inline-flex min-w-fit shrink-0 items-center gap-1.5 text-base font-semibold leading-none",
                          chartTone === "down" ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-7 items-center gap-1 rounded-md px-2",
                            priceSummaryClass,
                          )}
                        >
                          {chartTone === "down" ? (
                            <ArrowDownIcon className="size-4" aria-hidden="true" />
                          ) : (
                            <ArrowUpIcon className="size-4" aria-hidden="true" />
                          )}
                          {formatAbsolutePercent(rangePercent)}
                        </span>
                        <span>{formatSignedCompactCurrency(rangeChange)}</span>
                        <span className="text-muted-foreground">({range})</span>
                      </div>
                      {visibleWindowLabel && selectedSymbol ? (
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                          {visibleWindowLabel}
                        </span>
                      ) : null}
                      </>
                    ) : null}
                  </div>
                  {!(hasPriceSummary && latest) || !(visibleWindowLabel && selectedSymbol) ? (
                    <CardDescription>
                      {visibleWindowLabel && selectedSymbol
                        ? visibleWindowLabel
                        : "Start the backend API to load stored SQLite candles."}
                    </CardDescription>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="px-4 sm:px-5">
                <div className="relative">
                  <StockChart
                    candles={candles}
                    indicators={chartIndicators}
                    signals={chartSignals}
                    timeframe={timeframe}
                    visibleStartMs={candleWindow?.startMs}
                    visibleEndMs={candleWindow?.endMs}
                    mode={chartMode}
                    tone={chartTone}
                    loading={
                      candlesLoading ||
                      symbolsLoading ||
                      (activeTab === "strategies" ? strategyIndicatorsLoading : indicatorsLoading)
                    }
                    onVisibleCandlesChange={handleVisibleCandlesChange}
                    onHoverCandleChange={handleHoverCandleChange}
                  />
                  {activeTab === "strategies" ? (
                    <IndicatorLegend
                      className="absolute left-2 top-2 z-10 max-w-[75%] transition-opacity duration-200 motion-reduce:transition-none"
                      indicators={strategyPreviewSpecs}
                      definitionsByKind={indicatorDefinitionsByKind}
                      series={strategyIndicatorSeries}
                      valueTimestampMs={legendTimestampMs}
                      onUpdateLineStyle={updateStrategyIndicatorLineStyle}
                    />
                  ) : (
                    <IndicatorLegend
                      className="absolute left-2 top-2 z-10 max-w-[75%] transition-opacity duration-200 motion-reduce:transition-none"
                      indicators={activeIndicators}
                      definitionsByKind={indicatorDefinitionsByKind}
                      series={indicatorSeries}
                      valueTimestampMs={legendTimestampMs}
                      onUpdateParameter={updateIndicatorParameter}
                      onUpdateLineStyle={updateIndicatorLineStyle}
                      onRemove={removeIndicator}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
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

          <aside className="flex min-h-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
            <div ref={addPanelRef} className="relative px-1">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Symbols</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={addPanelOpen ? "Close add symbol" : "Add symbol"}
                  title={addPanelOpen ? "Close add symbol" : "Add symbol"}
                  onClick={() => setAddPanelOpen((open) => !open)}
                >
                  {addPanelOpen ? <XIcon /> : <PlusIcon />}
                </Button>
              </div>
              {addPanelOpen ? (
                <form
                  className="absolute left-1 right-1 top-[calc(100%+0.75rem)] z-20 flex gap-3 rounded-md border border-[var(--control-border)] bg-[var(--control-surface)] p-3 shadow-xl"
                  onSubmit={handleAddSymbolSubmit}
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      ref={addTickerInputRef}
                      value={addTickerInput}
                      onChange={(event) => setAddTickerInput(event.target.value.toUpperCase())}
                      placeholder="Ticker"
                      aria-label="Ticker to add"
                      disabled={addingSymbol}
                      maxLength={16}
                    />
                  </div>
                  <Button type="submit" variant="secondary" disabled={addingSymbol || symbolsLoading}>
                    {addingSymbol ? <RefreshCwIcon className="animate-spin" /> : <PlusIcon />}
                    {addingSymbol ? "Adding" : "Add"}
                  </Button>
                </form>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col gap-3">
              <div className="relative">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  value={symbolFilter}
                  onChange={(event) => setSymbolFilter(event.target.value.toUpperCase())}
                  placeholder="Search symbols"
                  aria-label="Search symbols"
                  className="pl-9"
                />
              </div>

              <div className="border-border min-h-72 overflow-y-auto rounded-md border">
                {symbolsLoading ? (
                  <div className="flex flex-col gap-2 p-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                ) : visibleSymbols.length > 0 ? (
                  <div className="flex flex-col p-1">
                    {visibleSymbols.map((symbol) => {
                      const isSelected = symbol.ticker === selectedTicker;
                      const timeframeLabels = symbol.timeframes
                        .map((item) => item.timeframe.toUpperCase())
                        .join(", ");

                      return (
                        <button
                          key={symbol.ticker}
                          type="button"
                          className={cn(
                            "hover:!bg-[var(--control-hover)] hover:!text-foreground flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                            isSelected && selectedSymbolClass,
                          )}
                          aria-pressed={isSelected}
                          disabled={deletingTicker === symbol.ticker}
                          onClick={() => selectSymbol(symbol)}
                          onContextMenu={(event) => openSymbolContextMenu(event, symbol.ticker)}
                        >
                          <span className="font-medium">{symbol.ticker}</span>
                          <span
                            className={cn(
                              "text-muted-foreground text-xs",
                              isSelected && "!text-current opacity-80",
                            )}
                          >
                            {timeframeLabels}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-muted-foreground flex min-h-72 items-center justify-center px-4 text-center text-sm">
                    {symbolFilter ? "No matching symbols." : "No stored symbols."}
                  </div>
                )}
              </div>

              {filteredSymbols.length > visibleSymbols.length ? (
                <p className="text-muted-foreground text-xs">
                  Showing first {formatCompact(visibleSymbols.length)}{" "}
                  {symbolFilter ? "matches" : "symbols"}.
                </p>
              ) : null}
            </div>
          </aside>
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
        <div
          className="bg-popover text-popover-foreground border-border fixed z-50 min-w-44 rounded-md border p-1 shadow-lg"
          style={{ left: symbolContextMenu.x, top: symbolContextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            role="menuitem"
            disabled={deletingTicker === symbolContextMenu.ticker}
            onClick={() => handleDeleteSymbol(symbolContextMenu.ticker)}
          >
            {deletingTicker === symbolContextMenu.ticker ? (
              <RefreshCwIcon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            Delete {symbolContextMenu.ticker}
          </button>
        </div>
      ) : null}
    </main>
  );
}
