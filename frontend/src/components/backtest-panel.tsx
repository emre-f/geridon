import { useMemo } from "react";
import { FlaskConicalIcon } from "lucide-react";

import type { IndicatorDefinition, IndicatorKind, StrategyRecord, SymbolSummary } from "@/lib/api";
import { useBacktestComparisons, maxComparisons } from "@/hooks/use-backtest-comparisons";
import { useBacktestForm } from "@/hooks/use-backtest-form";
import { useBacktestRunChart } from "@/hooks/use-backtest-run-chart";
import { useBacktestRuns } from "@/hooks/use-backtest-runs";
import { BacktestResultCard } from "@/components/backtest-result-card";
import { BacktestRunForm } from "@/components/backtest-run-form";
import { BacktestRunsList } from "@/components/backtest-runs-list";
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
  const form = useBacktestForm({ strategies, initialStrategyId, symbols, defaultTicker });
  // Reload past runs when the strategy definition is saved too, so the
  // "older rules" flags on them stay accurate.
  const strategyUpdatedAt =
    strategies.find((strategy) => strategy.id === form.strategyId)?.updated_at ?? null;
  const runs = useBacktestRuns({ form, strategyUpdatedAt });
  const runChart = useBacktestRunChart({
    activeRun: runs.activeRun,
    definitionsByKind,
    onError: runs.reportError,
  });
  const comparisons = useBacktestComparisons({ activeRun: runs.activeRun, symbols });

  const strategyName = useMemo(() => {
    const id = runs.activeRun?.strategy_id ?? form.strategyId;
    return (
      strategies.find((strategy) => strategy.id === id)?.name ??
      runs.activeRun?.strategy_snapshot.name ??
      "Strategy"
    );
  }, [runs.activeRun, form.strategyId, strategies]);

  const metrics = runs.activeRun?.metrics ?? null;

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
                buyPercent={form.buyPercent}
                coverage={form.coverage}
                endDate={form.endDate}
                initialCapital={form.initialCapital}
                positionMode={form.positionMode}
                running={runs.running}
                selectedSymbol={form.selectedSymbol}
                sellPercent={form.sellPercent}
                startDate={form.startDate}
                strategies={strategies}
                strategyId={form.strategyId}
                timeframe={form.timeframe}
                timeframes={form.timeframes}
                tickerList={form.tickerList}
                onBuyPercentChange={form.setBuyPercent}
                onEndDateChange={form.setEndDate}
                onInitialCapitalChange={form.setInitialCapital}
                onPositionModeChange={form.setPositionMode}
                onRun={runs.handleRun}
                onSellPercentChange={form.setSellPercent}
                onStartDateChange={form.setStartDate}
                onStrategyIdChange={form.setStrategyId}
                onTickerChange={form.setTicker}
                onTimeframeChange={form.setTimeframe}
              />

              {strategyDirty && form.strategyId === initialStrategyId ? (
                <p className="text-muted-foreground text-xs">
                  Heads up: this strategy has unsaved edits in the Strategies tab — runs use the
                  last saved version.
                </p>
              ) : null}

              {runs.error ? <p className="text-destructive text-sm">{runs.error}</p> : null}

              <Separator />

              <section className="flex flex-col gap-2" aria-label="Past runs">
                <h3 className="text-sm font-medium">Past runs</h3>
                <BacktestRunsList
                  activeRunId={runs.activeRun?.id}
                  openingRunId={runs.openingRunId}
                  runs={runs.runs}
                  runsLoading={runs.runsLoading}
                  onDeleteRun={runs.handleDeleteRun}
                  onOpenRun={runs.handleOpenRun}
                />
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {runs.activeRun && metrics ? (
        <BacktestResultCard
          activeRun={runs.activeRun}
          benchmarks={comparisons.benchmarks}
          chartMode={runChart.chartMode}
          comparisonData={comparisons.comparisonData}
          comparisons={comparisons.comparisons}
          definitionsByKind={definitionsByKind}
          equityOverlays={comparisons.equityOverlays}
          legendTimestampMs={runChart.legendTimestampMs}
          maxComparisons={maxComparisons}
          metrics={metrics}
          priceTone={runChart.priceTone}
          runCandles={runChart.runCandles}
          runCandlesLoading={runChart.runCandlesLoading}
          runIndicatorsForChart={runChart.runIndicatorsForChart}
          runIndicatorSeries={runChart.runIndicatorSeries}
          runIndicatorSpecs={runChart.runIndicatorSpecs}
          runSignals={runChart.runSignals}
          strategyName={strategyName}
          symbolsAvailable={symbols.length > 0}
          tickerList={form.tickerList}
          onAddComparison={comparisons.addComparison}
          onBenchmarkStyleChange={comparisons.patchBenchmarkStyle}
          onBenchmarkVisibleChange={comparisons.setBenchmarkVisible}
          onChartModeChange={runChart.setChartMode}
          onClose={runs.closeRun}
          onComparisonChange={comparisons.updateComparison}
          onHoverCandleChange={runChart.handleHoverCandleChange}
          onRemoveComparison={comparisons.removeComparison}
          onUpdateRunIndicatorLineStyle={runChart.updateRunIndicatorLineStyle}
        />
      ) : null}
    </div>
  );
}
