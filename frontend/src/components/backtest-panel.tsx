import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DownloadIcon,
  FlaskConicalIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  deleteBacktest,
  getBacktest,
  listCandles,
  listIndicators,
  listStrategyBacktests,
  runBacktest,
  type BacktestPositionMode,
  type BacktestRunRecord,
  type BacktestRunSummary,
  type Candle,
  type IndicatorDefinition,
  type IndicatorKind,
  type IndicatorLineStyle,
  type IndicatorSeries,
  type IndicatorSpec,
  type StrategyRecord,
  type SymbolSummary,
} from "@/lib/api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { defaultLineStyle, normalizeLineStyles } from "@/lib/indicator-style";
import { downloadBacktestCard } from "@/lib/share-card";
import { strategyIndicatorSpecs } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { ColorPicker } from "@/components/color-picker";
import { EquityChart, type EquityOverlay } from "@/components/equity-chart";
import { IndicatorLegend } from "@/components/indicator-legend";
import { StockChart, type ChartMode, type ChartTone } from "@/components/stock-chart";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SlashTabs } from "@/components/ui/slash-tabs";

const chartModeOptions = [
  { value: "line", label: "Line" },
  { value: "candle", label: "Candle" },
];

interface BacktestPanelProps {
  strategies: StrategyRecord[];
  /** Strategy selected in the Strategies tab; used as the starting selection. */
  initialStrategyId: number | null;
  strategyDirty: boolean;
  symbols: SymbolSummary[];
  defaultTicker: string;
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
}

interface ComparisonSlot {
  id: string;
  ticker: string;
  visible: boolean;
  style: IndicatorLineStyle;
}

interface ComparisonPoint {
  timestamp_ms: number;
  close: number;
}

const timeframeOrder = ["1h", "4h", "1d"];
const maxComparisons = 3;
const preferredComparisonTickers = ["SPY", "QQQ"];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px] font-medium">{label}</span>
      {children}
    </label>
  );
}

function symbolTimeframes(symbol: SymbolSummary | undefined) {
  if (!symbol) {
    return [];
  }
  const stored = new Set(symbol.timeframes.map((timeframe) => timeframe.timeframe));
  const values: string[] = [];
  if (stored.has("1h")) {
    values.push("1h", "4h");
  }
  if (stored.has("1d")) {
    values.push("1d");
  }
  return values.sort((left, right) => timeframeOrder.indexOf(left) - timeframeOrder.indexOf(right));
}

function symbolCoverage(symbol: SymbolSummary | undefined, timeframe: string) {
  const sourceTimeframe = timeframe === "4h" ? "1h" : timeframe;
  return symbol?.timeframes.find((item) => item.timeframe === sourceTimeframe);
}

function toDateInputValue(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayStartMs(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function dayEndMs(value: string) {
  return Date.parse(`${value}T23:59:59.999Z`);
}

function formatRunRange(run: BacktestRunSummary) {
  return `${formatDate(run.start_ms, "1d")} – ${formatDate(run.end_ms, "1d")}`;
}

function formatRunSizing(run: BacktestRunSummary) {
  return run.position_mode === "always_in"
    ? "always in market (100% flips)"
    : `buy ${run.buy_percent}% / sell ${run.sell_percent}%`;
}

function formatRanAt(createdAt: string) {
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const ms = Date.parse(createdAt.includes("Z") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(ms)) {
    return createdAt;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function comparisonCacheKey(ticker: string, run: BacktestRunRecord) {
  return `${ticker}|${run.timeframe}|${run.start_ms}|${run.end_ms}`;
}

function createComparisonId() {
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Buy-and-hold curve: the run's starting capital riding the ticker's closes. */
function holdCurve(points: ComparisonPoint[], initialCapital: number) {
  const first = points.find((point) => point.close > 0);
  if (!first) {
    return [];
  }
  return points.map((point) => ({
    timestamp_ms: point.timestamp_ms,
    value: (initialCapital * point.close) / first.close,
  }));
}

/**
 * The Backtest tab: run a saved strategy through the simulator, inspect the
 * fills on a full price chart, and compare the PnL curve against buy-and-hold
 * benchmarks of any stored symbols.
 */
export function BacktestPanel({
  strategies,
  initialStrategyId,
  strategyDirty,
  symbols,
  defaultTicker,
  definitionsByKind,
}: BacktestPanelProps) {
  const [strategyId, setStrategyId] = useState<number | null>(initialStrategyId);
  const [ticker, setTicker] = useState(defaultTicker);
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [positionMode, setPositionMode] = useState<BacktestPositionMode>("long_only");
  const [buyPercent, setBuyPercent] = useState(100);
  const [sellPercent, setSellPercent] = useState(100);
  const [initialCapital, setInitialCapital] = useState(10_000);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [activeRun, setActiveRun] = useState<BacktestRunRecord | null>(null);
  const [openingRunId, setOpeningRunId] = useState<number | null>(null);

  // Price chart state for the active run.
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [runCandles, setRunCandles] = useState<Candle[]>([]);
  const [runCandlesLoading, setRunCandlesLoading] = useState(false);
  const [runIndicatorSpecs, setRunIndicatorSpecs] = useState<IndicatorSpec[]>([]);
  const [runIndicatorSeries, setRunIndicatorSeries] = useState<IndicatorSeries[]>([]);
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);

  // PnL comparison overlays: "hold the backtested stock" plus custom tickers.
  const [holdSelfVisible, setHoldSelfVisible] = useState(true);
  const [holdSelfStyle, setHoldSelfStyle] = useState<IndicatorLineStyle>(() => ({
    ...defaultLineStyle(0),
    stroke: "dashed",
  }));
  const [comparisons, setComparisons] = useState<ComparisonSlot[]>([]);
  const [comparisonData, setComparisonData] = useState<Record<string, ComparisonPoint[]>>({});
  const comparisonRequests = useRef(new Set<string>());

  const selectedSymbol = useMemo(
    () => symbols.find((symbol) => symbol.ticker === ticker) ?? symbols[0],
    [symbols, ticker],
  );
  const tickerList = useMemo(() => symbols.map((symbol) => symbol.ticker), [symbols]);
  const timeframes = useMemo(() => symbolTimeframes(selectedSymbol), [selectedSymbol]);
  const coverage = useMemo(
    () => symbolCoverage(selectedSymbol, timeframe),
    [selectedSymbol, timeframe],
  );
  const strategyName = useMemo(() => {
    const id = activeRun?.strategy_id ?? strategyId;
    return (
      strategies.find((strategy) => strategy.id === id)?.name ??
      activeRun?.strategy_snapshot.name ??
      "Strategy"
    );
  }, [activeRun, strategyId, strategies]);

  // Keep the chosen strategy/ticker/timeframe valid as stored data changes.
  useEffect(() => {
    if (strategies.length === 0) {
      setStrategyId(null);
      return;
    }
    if (strategyId == null || !strategies.some((strategy) => strategy.id === strategyId)) {
      setStrategyId(
        initialStrategyId != null && strategies.some((strategy) => strategy.id === initialStrategyId)
          ? initialStrategyId
          : strategies[0].id,
      );
    }
  }, [initialStrategyId, strategies, strategyId]);

  useEffect(() => {
    if (symbols.length > 0 && !symbols.some((symbol) => symbol.ticker === ticker)) {
      setTicker(symbols.some((symbol) => symbol.ticker === defaultTicker) ? defaultTicker : symbols[0].ticker);
    }
  }, [defaultTicker, symbols, ticker]);

  useEffect(() => {
    if (timeframes.length > 0 && !timeframes.includes(timeframe)) {
      setTimeframe(timeframes.includes("1d") ? "1d" : timeframes[0]);
    }
  }, [timeframe, timeframes]);

  // Default the range to the full stored coverage whenever it changes.
  useEffect(() => {
    if (coverage) {
      setStartDate(toDateInputValue(coverage.start_ms));
      setEndDate(toDateInputValue(coverage.end_ms));
    }
  }, [coverage]);

  useEffect(() => {
    setActiveRun(null);
    setError(null);
    setRuns([]);

    if (strategyId == null) {
      return;
    }

    let cancelled = false;
    setRunsLoading(true);

    listStrategyBacktests(strategyId)
      .then((records) => {
        if (!cancelled) {
          setRuns(records);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load past runs.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRunsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  // Load the active run's candles and the indicators its strategy reads.
  useEffect(() => {
    setHoverCandle(null);
    setRunCandles([]);
    setRunIndicatorSeries([]);

    if (!activeRun) {
      setRunIndicatorSpecs([]);
      return;
    }

    const specs = strategyIndicatorSpecs(activeRun.strategy_snapshot, definitionsByKind);
    setRunIndicatorSpecs(specs);

    let cancelled = false;
    setRunCandlesLoading(true);

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
          setRunCandles(candles);
          setRunIndicatorSeries(series);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the run's chart.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRunCandlesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRun, definitionsByKind]);

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
      if (comparisonData[key] || comparisonRequests.current.has(key)) {
        continue;
      }
      comparisonRequests.current.add(key);

      listCandles({
        ticker: wantedTicker,
        timeframe: activeRun.timeframe,
        startMs: activeRun.start_ms,
        endMs: activeRun.end_ms,
      })
        .then((candles) => {
          setComparisonData((current) => ({
            ...current,
            [key]: candles.map((candle) => ({
              timestamp_ms: candle.timestamp_ms,
              close: candle.close,
            })),
          }));
        })
        .catch(() => {
          // Cache the miss so a symbol without coverage isn't refetched.
          setComparisonData((current) => ({ ...current, [key]: [] }));
        })
        .finally(() => {
          comparisonRequests.current.delete(key);
        });
    }
  }, [activeRun, comparisons, comparisonData, holdSelfVisible]);

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

  const handleHoverCandleChange = useCallback((nextHoverCandle: Candle | null) => {
    setHoverCandle(nextHoverCandle);
  }, []);

  function updateRunIndicatorLineStyle(
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) {
    setRunIndicatorSpecs((currentSpecs) =>
      currentSpecs.map((spec, specIndex) => {
        if (spec.id !== id) {
          return spec;
        }
        const definition = definitionsByKind.get(spec.kind);
        const slotCount = definition?.values?.length ?? slotIndex + 1;
        const styles = normalizeLineStyles(spec.styles, Math.max(slotCount, slotIndex + 1), specIndex);
        styles[slotIndex] = { ...styles[slotIndex], ...patch };
        return { ...spec, styles };
      }),
    );
  }

  function addComparison() {
    setComparisons((current) => {
      if (current.length >= maxComparisons) {
        return current;
      }
      const used = new Set([activeRun?.ticker, ...current.map((slot) => slot.ticker)]);
      const nextTicker =
        preferredComparisonTickers.find(
          (candidate) => !used.has(candidate) && symbols.some((symbol) => symbol.ticker === candidate),
        ) ??
        symbols.find((symbol) => !used.has(symbol.ticker))?.ticker ??
        symbols[0]?.ticker;
      if (!nextTicker) {
        return current;
      }
      return [
        ...current,
        {
          id: createComparisonId(),
          ticker: nextTicker,
          visible: true,
          style: defaultLineStyle(current.length + 1),
        },
      ];
    });
  }

  function updateComparison(id: string, patch: Partial<ComparisonSlot>) {
    setComparisons((current) =>
      current.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  }

  async function handleRun() {
    if (strategyId == null || !selectedSymbol) {
      return;
    }

    const startMs = dayStartMs(startDate);
    const endMs = dayEndMs(endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      setError("Pick a valid date range.");
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const record = await runBacktest({
        strategyId,
        ticker: selectedSymbol.ticker,
        timeframe,
        startMs,
        endMs,
        positionMode,
        buyPercent,
        sellPercent,
        initialCapital,
      });
      setActiveRun(record);
      setRuns((current) => [
        {
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
          created_at: record.created_at,
        },
        ...current,
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not run the backtest.");
    } finally {
      setRunning(false);
    }
  }

  async function handleOpenRun(run: BacktestRunSummary) {
    if (activeRun?.id === run.id) {
      return;
    }

    setOpeningRunId(run.id);
    setError(null);
    try {
      setActiveRun(await getBacktest(run.id));
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not load the run.");
    } finally {
      setOpeningRunId(null);
    }
  }

  async function handleDeleteRun(run: BacktestRunSummary) {
    if (!window.confirm(`Delete this ${run.ticker} run from ${formatRanAt(run.created_at)}?`)) {
      return;
    }

    setError(null);
    try {
      await deleteBacktest(run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (activeRun?.id === run.id) {
        setActiveRun(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the run.");
    }
  }

  const metrics = activeRun?.metrics ?? null;
  const returnTone =
    metrics && metrics.total_return_pct < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="gap-4">
        <CardHeader className="gap-1 px-4 sm:px-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FlaskConicalIcon className="size-5" />
            Backtest
          </CardTitle>
          <CardDescription>
            Simulate a saved strategy bar by bar; signals fill at the next bar's open. Long only
            sizes buys as a % of equity and sells as a % of the position. Always in market is
            stop-and-reverse: every signal flips the whole account 100% long or 100% short
            (cash-secured, no leverage or borrow costs).
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
          {strategies.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Save a strategy in the Strategies tab first — backtest runs are stored under a saved
              strategy.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Strategy">
                  <Select
                    value={strategyId == null ? "" : String(strategyId)}
                    aria-label="Backtest strategy"
                    className="w-48"
                    onChange={(event) => setStrategyId(Number(event.target.value))}
                  >
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>
                        {strategy.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Symbol">
                  <SymbolCombobox
                    value={selectedSymbol?.ticker ?? ""}
                    tickers={tickerList}
                    ariaLabel="Backtest symbol"
                    className="w-28"
                    onSelect={setTicker}
                  />
                </Field>
                <Field label="Timeframe">
                  <Select
                    value={timeframe}
                    aria-label="Backtest timeframe"
                    className="w-20"
                    onChange={(event) => setTimeframe(event.target.value)}
                  >
                    {timeframes.map((value) => (
                      <option key={value} value={value}>
                        {value.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="From">
                  <Input
                    type="date"
                    value={startDate}
                    aria-label="Backtest start date"
                    className="w-36"
                    min={coverage ? toDateInputValue(coverage.start_ms) : undefined}
                    max={endDate || undefined}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </Field>
                <Field label="To">
                  <Input
                    type="date"
                    value={endDate}
                    aria-label="Backtest end date"
                    className="w-36"
                    min={startDate || undefined}
                    max={coverage ? toDateInputValue(coverage.end_ms) : undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </Field>
                <Field label="Mode">
                  <Select
                    value={positionMode}
                    aria-label="Position mode"
                    className="w-40"
                    onChange={(event) => setPositionMode(event.target.value as BacktestPositionMode)}
                  >
                    <option value="long_only">Long only</option>
                    <option value="always_in">Always in market</option>
                  </Select>
                </Field>
                <Field label="Buy % of equity">
                  <NumberInput
                    className="w-24"
                    aria-label="Buy percent of equity"
                    value={positionMode === "always_in" ? 100 : buyPercent}
                    min={1}
                    max={100}
                    step={1}
                    disabled={positionMode === "always_in"}
                    title={
                      positionMode === "always_in"
                        ? "Always in market flips the whole account, so sizing is fixed at 100%."
                        : undefined
                    }
                    onValueChange={setBuyPercent}
                  />
                </Field>
                <Field label="Sell % of position">
                  <NumberInput
                    className="w-24"
                    aria-label="Sell percent of position"
                    value={positionMode === "always_in" ? 100 : sellPercent}
                    min={1}
                    max={100}
                    step={1}
                    disabled={positionMode === "always_in"}
                    title={
                      positionMode === "always_in"
                        ? "Always in market flips the whole account, so sizing is fixed at 100%."
                        : undefined
                    }
                    onValueChange={setSellPercent}
                  />
                </Field>
                <Field label="Starting capital">
                  <NumberInput
                    className="w-28"
                    aria-label="Starting capital"
                    value={initialCapital}
                    min={100}
                    max={100_000_000}
                    step={1000}
                    onValueChange={setInitialCapital}
                  />
                </Field>
                <Button type="button" onClick={handleRun} disabled={running || !selectedSymbol || strategyId == null}>
                  {running ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
                  Run backtest
                </Button>
              </div>

              {strategyDirty && strategyId === initialStrategyId ? (
                <p className="text-muted-foreground text-xs">
                  Heads up: this strategy has unsaved edits in the Strategies tab — runs use the
                  last saved version.
                </p>
              ) : null}

              {error ? <p className="text-destructive text-sm">{error}</p> : null}

              <Separator />

              <section className="flex flex-col gap-2" aria-label="Past runs">
                <h3 className="text-sm font-medium">Past runs</h3>
                {runsLoading ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : runs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No runs yet for this strategy.</p>
                ) : (
                  <div className="flex flex-col">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className={cn(
                          "hover:bg-muted/50 group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
                          activeRun?.id === run.id && "bg-muted/60",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-left"
                          onClick={() => handleOpenRun(run)}
                        >
                          <span className="text-muted-foreground w-28 shrink-0 text-xs">
                            {formatRanAt(run.created_at)}
                          </span>
                          <span className="w-14 shrink-0 font-medium">{run.ticker}</span>
                          <span className="text-muted-foreground w-8 shrink-0 text-xs">
                            {run.timeframe.toUpperCase()}
                          </span>
                          {run.position_mode === "always_in" ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              L/S
                            </Badge>
                          ) : null}
                          <span className="text-muted-foreground text-xs">{formatRunRange(run)}</span>
                          <span
                            className={cn(
                              "ml-auto font-medium",
                              run.metrics.total_return_pct < 0
                                ? "text-[var(--chart-down)]"
                                : "text-[var(--chart-up)]",
                            )}
                          >
                            {formatPercent(run.metrics.total_return_pct)}
                          </span>
                          {openingRunId === run.id ? (
                            <RefreshCwIcon className="text-muted-foreground size-3.5 animate-spin" />
                          ) : null}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive size-7 opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Delete run"
                          onClick={() => handleDeleteRun(run)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {activeRun && metrics ? (
        <Card className="gap-4">
          <CardHeader className="flex flex-col gap-3 px-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">
                {activeRun.ticker}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {strategyName}
                </span>
              </CardTitle>
              <span className="text-muted-foreground text-xs">
                {formatRunRange(activeRun)} · {activeRun.timeframe.toUpperCase()} ·{" "}
                {formatRunSizing(activeRun)} · ran {formatRanAt(activeRun.created_at)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <SlashTabs
                  options={chartModeOptions}
                  value={chartMode}
                  onValueChange={(value) => setChartMode(value as ChartMode)}
                  aria-label="Chart style"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadBacktestCard(activeRun, strategyName)}
                >
                  <DownloadIcon />
                  Save as image
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-8"
                  aria-label="Close results"
                  onClick={() => setActiveRun(null)}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
            <div className="relative">
              <StockChart
                candles={runCandles}
                indicators={runIndicatorsForChart}
                signals={runSignals}
                timeframe={activeRun.timeframe}
                visibleStartMs={activeRun.start_ms}
                visibleEndMs={activeRun.end_ms}
                mode={chartMode}
                tone={priceTone}
                loading={runCandlesLoading}
                onHoverCandleChange={handleHoverCandleChange}
              />
              <IndicatorLegend
                className="absolute left-2 top-2 z-10 max-w-[75%]"
                indicators={runIndicatorSpecs}
                definitionsByKind={definitionsByKind}
                series={runIndicatorSeries}
                valueTimestampMs={legendTimestampMs}
                onUpdateLineStyle={updateRunIndicatorLineStyle}
              />
            </div>

            <Separator />

            <section className="flex flex-col gap-3" aria-label="Backtest results">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="border-border rounded-md border p-3">
                  <p className="text-muted-foreground text-[11px] font-medium uppercase">
                    Total return
                  </p>
                  <p className={cn("mt-1 text-2xl font-semibold leading-none", returnTone)}>
                    {formatPercent(metrics.total_return_pct)}
                  </p>
                </div>
                <div className="border-border rounded-md border p-3">
                  <p className="text-muted-foreground text-[11px] font-medium uppercase">
                    Final equity
                  </p>
                  <p className="mt-1 text-2xl font-semibold leading-none">
                    {formatCurrency(metrics.final_equity)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    from {formatCurrency(metrics.initial_capital)}
                  </p>
                </div>
                <div className="border-border rounded-md border p-3">
                  <p className="text-muted-foreground text-[11px] font-medium uppercase">Trades</p>
                  <p className="mt-1 text-2xl font-semibold leading-none">{metrics.trade_count}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {metrics.buy_count} buys · {metrics.sell_count} sells
                  </p>
                </div>
                <div className="border-border rounded-md border p-3">
                  <p className="text-muted-foreground text-[11px] font-medium uppercase">
                    Win rate
                  </p>
                  <p className="mt-1 text-2xl font-semibold leading-none">
                    {metrics.win_rate_pct == null ? "—" : `${metrics.win_rate_pct.toFixed(0)}%`}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">of closing trades</p>
                </div>
              </div>

              <EquityChart
                points={activeRun.equity_curve}
                trades={activeRun.trades}
                initialCapital={activeRun.initial_capital}
                timeframe={activeRun.timeframe}
                overlays={equityOverlays}
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="PnL comparisons">
                <span className="text-muted-foreground text-xs font-medium">Compare</span>

                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={holdSelfVisible}
                    aria-label={`Show hold ${activeRun.ticker}`}
                    onChange={(event) => setHoldSelfVisible(event.target.checked)}
                  />
                  <ColorPicker
                    value={holdSelfStyle.color}
                    ariaLabel={`Hold ${activeRun.ticker} color and line style`}
                    lineStyle={{
                      stroke: holdSelfStyle.stroke,
                      width: holdSelfStyle.width,
                      opacity: holdSelfStyle.opacity,
                    }}
                    onChange={(color) => setHoldSelfStyle((current) => ({ ...current, color }))}
                    onLineStyleChange={(patch) =>
                      setHoldSelfStyle((current) => ({ ...current, ...patch }))
                    }
                  />
                  <span>Hold {activeRun.ticker}</span>
                </label>

                {comparisons.map((slot) => (
                  <div key={slot.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      checked={slot.visible}
                      aria-label={`Show ${slot.ticker} comparison`}
                      onChange={(event) => updateComparison(slot.id, { visible: event.target.checked })}
                    />
                    <ColorPicker
                      value={slot.style.color}
                      ariaLabel={`${slot.ticker} comparison color and line style`}
                      lineStyle={{
                        stroke: slot.style.stroke,
                        width: slot.style.width,
                        opacity: slot.style.opacity,
                      }}
                      onChange={(color) =>
                        updateComparison(slot.id, { style: { ...slot.style, color } })
                      }
                      onLineStyleChange={(patch) =>
                        updateComparison(slot.id, { style: { ...slot.style, ...patch } })
                      }
                    />
                    <SymbolCombobox
                      value={slot.ticker}
                      tickers={tickerList}
                      ariaLabel="Comparison symbol"
                      className="w-28"
                      onSelect={(nextTicker) => updateComparison(slot.id, { ticker: nextTicker })}
                    />
                    {slot.visible &&
                    comparisonData[comparisonCacheKey(slot.ticker, activeRun)]?.length === 0 ? (
                      <span className="text-muted-foreground text-xs">(no data)</span>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-7"
                      aria-label={`Remove ${slot.ticker} comparison`}
                      onClick={() =>
                        setComparisons((current) => current.filter((item) => item.id !== slot.id))
                      }
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                ))}

                {comparisons.length < maxComparisons && symbols.length > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={addComparison}>
                    <PlusIcon />
                    Add comparison
                  </Button>
                ) : null}
              </div>

              {activeRun.trades.length > 0 ? (
                <div className="border-border max-h-64 overflow-auto rounded-md border">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-muted/60 sticky top-0 backdrop-blur">
                      <tr className="text-muted-foreground text-left text-xs">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Side</th>
                        <th className="px-3 py-2 text-right font-medium">Price</th>
                        <th className="px-3 py-2 text-right font-medium">Shares</th>
                        <th className="px-3 py-2 text-right font-medium">Value</th>
                        <th className="px-3 py-2 text-right font-medium">Realized P&L</th>
                        <th className="px-3 py-2 text-right font-medium">Equity after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRun.trades.map((trade, index) => (
                        <tr key={`${trade.timestamp_ms}-${index}`} className="border-border border-t">
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {formatDate(trade.timestamp_ms, activeRun.timeframe)}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={
                                trade.side === "buy"
                                  ? "text-[var(--chart-up)]"
                                  : "text-[var(--chart-down)]"
                              }
                            >
                              {trade.side === "buy" ? "Buy" : "Sell"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right">{formatCurrency(trade.price)}</td>
                          <td className="px-3 py-1.5 text-right">{trade.shares.toFixed(4)}</td>
                          <td className="px-3 py-1.5 text-right">{formatCurrency(trade.value)}</td>
                          <td
                            className={cn(
                              "px-3 py-1.5 text-right",
                              trade.realized_pnl == null
                                ? "text-muted-foreground"
                                : trade.realized_pnl < 0
                                  ? "text-[var(--chart-down)]"
                                  : "text-[var(--chart-up)]",
                            )}
                          >
                            {trade.realized_pnl == null ? "—" : formatCurrency(trade.realized_pnl)}
                          </td>
                          <td className="px-3 py-1.5 text-right">{formatCurrency(trade.equity_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No trades executed — the entry condition never triggered in this range.
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
