import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConicalIcon } from "lucide-react";

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
import {
  comparisonCacheKey,
  createComparisonId,
  dayEndMs,
  dayStartMs,
  formatRanAt,
  holdCurve,
  toDateInputValue,
  type ComparisonPoint,
} from "@/lib/backtest-utils";
import {
  availableTimeframes,
  coverageForTimeframe,
} from "@/lib/chart-options";
import { defaultLineStyle, normalizeLineStyles } from "@/lib/indicator-style";
import { strategyIndicatorSpecs } from "@/lib/strategy";
import type { ComparisonSlot } from "@/components/backtest-types";
import { BacktestResultCard } from "@/components/backtest-result-card";
import { BacktestRunForm } from "@/components/backtest-run-form";
import { BacktestRunsList } from "@/components/backtest-runs-list";
import type { EquityOverlay } from "@/components/equity-chart";
import type { ChartMode, ChartTone } from "@/components/stock-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface BacktestPanelProps {
  strategies: StrategyRecord[];
  /** Strategy selected in the Strategies tab; used as the starting selection. */
  initialStrategyId: number | null;
  strategyDirty: boolean;
  symbols: SymbolSummary[];
  defaultTicker: string;
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
}

const maxComparisons = 3;
const preferredComparisonTickers = ["SPY", "QQQ"];

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
  const timeframes = useMemo(() => availableTimeframes(selectedSymbol), [selectedSymbol]);
  const coverage = useMemo(
    () => coverageForTimeframe(selectedSymbol, timeframe),
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

  // Reload when the strategy definition is saved too, so the "older rules"
  // flags on past runs stay accurate.
  const strategyUpdatedAt =
    strategies.find((strategy) => strategy.id === strategyId)?.updated_at ?? null;

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
  }, [strategyId, strategyUpdatedAt]);

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
          strategy_outdated: record.strategy_outdated,
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
              <BacktestRunForm
                buyPercent={buyPercent}
                coverage={coverage}
                endDate={endDate}
                initialCapital={initialCapital}
                positionMode={positionMode}
                running={running}
                selectedSymbol={selectedSymbol}
                sellPercent={sellPercent}
                startDate={startDate}
                strategies={strategies}
                strategyId={strategyId}
                timeframe={timeframe}
                timeframes={timeframes}
                tickerList={tickerList}
                onBuyPercentChange={setBuyPercent}
                onEndDateChange={setEndDate}
                onInitialCapitalChange={setInitialCapital}
                onPositionModeChange={setPositionMode}
                onRun={handleRun}
                onSellPercentChange={setSellPercent}
                onStartDateChange={setStartDate}
                onStrategyIdChange={setStrategyId}
                onTickerChange={setTicker}
                onTimeframeChange={setTimeframe}
              />

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
                <BacktestRunsList
                  activeRunId={activeRun?.id}
                  openingRunId={openingRunId}
                  runs={runs}
                  runsLoading={runsLoading}
                  onDeleteRun={handleDeleteRun}
                  onOpenRun={handleOpenRun}
                />
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {activeRun && metrics ? (
        <BacktestResultCard
          activeRun={activeRun}
          chartMode={chartMode}
          comparisonData={comparisonData}
          comparisons={comparisons}
          definitionsByKind={definitionsByKind}
          equityOverlays={equityOverlays}
          holdSelfStyle={holdSelfStyle}
          holdSelfVisible={holdSelfVisible}
          legendTimestampMs={legendTimestampMs}
          maxComparisons={maxComparisons}
          metrics={metrics}
          priceTone={priceTone}
          runCandles={runCandles}
          runCandlesLoading={runCandlesLoading}
          runIndicatorsForChart={runIndicatorsForChart}
          runIndicatorSeries={runIndicatorSeries}
          runIndicatorSpecs={runIndicatorSpecs}
          runSignals={runSignals}
          strategyName={strategyName}
          symbolsAvailable={symbols.length > 0}
          tickerList={tickerList}
          onAddComparison={addComparison}
          onChartModeChange={setChartMode}
          onClose={() => setActiveRun(null)}
          onComparisonChange={updateComparison}
          onHoldSelfStyleChange={(patch) =>
            setHoldSelfStyle((current) => ({ ...current, ...patch }))
          }
          onHoldSelfVisibleChange={setHoldSelfVisible}
          onHoverCandleChange={handleHoverCandleChange}
          onRemoveComparison={(id) =>
            setComparisons((current) => current.filter((item) => item.id !== id))
          }
          onUpdateRunIndicatorLineStyle={updateRunIndicatorLineStyle}
        />
      ) : null}
    </div>
  );
}
