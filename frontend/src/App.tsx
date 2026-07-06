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
  deleteSymbol,
  listIndicatorCatalog,
  listCandles,
  listIndicators,
  listSymbols,
  syncCandles,
  validateSymbol,
  type Candle,
  type IndicatorDefinition,
  type IndicatorKind,
  type IndicatorLineStyle,
  type IndicatorParameterDefinition,
  type IndicatorSpec,
  type IndicatorSeries,
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
  loadLastTicker,
  pullChartStates,
  removeChartState,
  saveChartState,
  saveLastTicker,
} from "@/lib/chart-state";
import {
  defaultLineStyle,
  definitionValueSlots,
  normalizeLineStyles,
} from "@/lib/indicator-style";
import { cn } from "@/lib/utils";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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


export default function App() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
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
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [indicatorsLoading, setIndicatorsLoading] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [deletingTicker, setDeletingTicker] = useState<string | null>(null);
  const [symbolContextMenu, setSymbolContextMenu] = useState<SymbolContextMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const selectedControlClass =
    "!border-[var(--control-border)] !bg-[var(--control-surface)] !text-[var(--control-muted-foreground)] hover:!bg-[var(--control-muted)] hover:!text-[var(--control-muted-foreground)] data-[state=on]:!bg-[var(--control-selected)] data-[state=on]:!text-[var(--control-selected-foreground)] data-[state=on]:hover:!bg-[var(--control-selected-hover)]";
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

    saveChartState(selectedTicker, {
      chartMode,
      timeframe,
      range,
      indicators: activeIndicators,
    });
    saveLastTicker(selectedTicker);
  }, [activeIndicators, chartMode, range, selectedTicker, timeframe]);

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
          <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
            <h1 className="text-lg font-semibold leading-none">geridon</h1>
            <span className="text-muted-foreground truncate text-sm leading-none">
              | backtest your trading strategies
            </span>
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
            <Card className="gap-4">
              <CardHeader className="flex flex-col gap-4 px-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIndicatorPickerOpen(true)}
                    disabled={indicatorCatalog.length === 0}
                  >
                    <PlusIcon />
                    Indicators
                  </Button>

                  <ToggleGroup
                    type="single"
                    value={chartMode}
                    onValueChange={(value) => value && setChartMode(value as ChartMode)}
                    aria-label="Chart style"
                  >
                    <ToggleGroupItem value="line" className={selectedControlClass}>
                      Line
                    </ToggleGroupItem>
                    <ToggleGroupItem value="candle" className={selectedControlClass}>
                      Candle
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <ToggleGroup
                    type="single"
                    value={timeframe}
                    onValueChange={handleTimeframeChange}
                    aria-label="Candle timeframe"
                  >
                    {timeframeOptions.map((option) => (
                      <ToggleGroupItem
                        key={option.value}
                        value={option.value}
                        disabled={!timeframes.includes(option.value)}
                        className={selectedControlClass}
                      >
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>

                  <ToggleGroup
                    type="single"
                    value={range}
                    onValueChange={handleRangeChange}
                    aria-label="Visible range"
                  >
                    {rangeOptions.map((option) => (
                      <ToggleGroupItem key={option.value} value={option.value} className={selectedControlClass}>
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <CardTitle className="text-xl">{selectedTicker || "No symbol selected"}</CardTitle>
                  {symbolsLoading || candlesLoading ? (
                    <Skeleton className="h-12 w-full max-w-[34rem]" />
                  ) : hasPriceSummary && latest ? (
                    <div className="flex items-center gap-3 whitespace-nowrap">
                      <div className="shrink-0 text-[clamp(2rem,5vw,2.25rem)] font-medium leading-none tracking-normal text-foreground">
                        {formatCurrency(latest.close)}
                      </div>
                      <div
                        className={cn(
                          "inline-flex min-w-fit shrink-0 items-center gap-2 text-[clamp(1rem,2.5vw,1.5rem)] font-semibold leading-none",
                          chartTone === "down" ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5",
                            priceSummaryClass,
                          )}
                        >
                          {chartTone === "down" ? (
                            <ArrowDownIcon className="size-[1.125rem]" aria-hidden="true" />
                          ) : (
                            <ArrowUpIcon className="size-[1.125rem]" aria-hidden="true" />
                          )}
                          {formatAbsolutePercent(rangePercent)}
                        </span>
                        <span>{formatSignedCompactCurrency(rangeChange)}</span>
                        <span className="text-muted-foreground">({range})</span>
                      </div>
                    </div>
                  ) : null}
                  <CardDescription>
                    {visibleWindowLabel && selectedSymbol
                      ? visibleWindowLabel
                      : "Start the backend API to load stored SQLite candles."}
                  </CardDescription>
                </div>
              </CardHeader>
  
              <CardContent className="px-4 sm:px-5">
                <div className="relative">
                  <StockChart
                    candles={candles}
                    indicators={indicatorsForChart}
                    timeframe={timeframe}
                    visibleStartMs={candleWindow?.startMs}
                    visibleEndMs={candleWindow?.endMs}
                    mode={chartMode}
                    tone={chartTone}
                    loading={candlesLoading || symbolsLoading || indicatorsLoading}
                    onVisibleCandlesChange={handleVisibleCandlesChange}
                    onHoverCandleChange={handleHoverCandleChange}
                  />
                  <IndicatorLegend
                    className="absolute left-2 top-2 z-10 max-w-[75%]"
                    indicators={activeIndicators}
                    definitionsByKind={indicatorDefinitionsByKind}
                    series={indicatorSeries}
                    valueTimestampMs={legendTimestampMs}
                    onUpdateParameter={updateIndicatorParameter}
                    onUpdateLineStyle={updateIndicatorLineStyle}
                    onRemove={removeIndicator}
                  />
                </div>
              </CardContent>
            </Card>
  
            <StrategyBuilder catalog={indicatorCatalog} />
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
