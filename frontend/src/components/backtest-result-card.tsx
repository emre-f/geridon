import { ShareIcon, XIcon } from "lucide-react";

import type {
  BacktestMetrics,
  BacktestRunRecord,
  Candle,
  IndicatorDefinition,
  IndicatorKind,
  IndicatorLineStyle,
  IndicatorSeries,
  IndicatorSpec,
  StrategySignal,
} from "@/lib/api";
import { type ComparisonPoint } from "@/lib/backtest-utils";
import { chartModeOptions } from "@/lib/chart-options";
import { downloadBacktestCard } from "@/lib/share-card";
import type { ComparisonSlot } from "@/components/backtest-types";
import { BacktestComparisons } from "@/components/backtest-comparisons";
import { BenchmarkMetrics } from "@/components/benchmark-metrics";
import { BacktestSection } from "@/components/backtest-section";
import { BacktestStrategyDetails } from "@/components/backtest-strategy-details";
import { BacktestSummary } from "@/components/backtest-summary";
import { BacktestTradesTable } from "@/components/backtest-trades-table";
import { EquityChart, type EquityOverlay } from "@/components/equity-chart";
import { IndicatorLegend } from "@/components/indicator-legend";
import { StockChart, type ChartMode, type ChartTone } from "@/components/stock-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlashTabs } from "@/components/ui/slash-tabs";

export function BacktestResultCard({
  activeRun,
  chartMode,
  comparisonData,
  comparisons,
  definitionsByKind,
  equityOverlays,
  holdSelfStyle,
  holdSelfVisible,
  legendTimestampMs,
  maxComparisons,
  metrics,
  priceTone,
  runCandles,
  runCandlesLoading,
  runIndicatorsForChart,
  runIndicatorSeries,
  runIndicatorSpecs,
  runSignals,
  strategyName,
  symbolsAvailable,
  tickerList,
  onAddComparison,
  onChartModeChange,
  onClose,
  onComparisonChange,
  onHoldSelfStyleChange,
  onHoldSelfVisibleChange,
  onHoverCandleChange,
  onRemoveComparison,
  onUpdateRunIndicatorLineStyle,
}: {
  activeRun: BacktestRunRecord;
  chartMode: ChartMode;
  comparisonData: Record<string, ComparisonPoint[]>;
  comparisons: ComparisonSlot[];
  definitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  equityOverlays: EquityOverlay[];
  holdSelfStyle: IndicatorLineStyle;
  holdSelfVisible: boolean;
  legendTimestampMs: number | null;
  maxComparisons: number;
  metrics: BacktestMetrics;
  priceTone: ChartTone;
  runCandles: Candle[];
  runCandlesLoading: boolean;
  runIndicatorsForChart: IndicatorSeries[];
  runIndicatorSeries: IndicatorSeries[];
  runIndicatorSpecs: IndicatorSpec[];
  runSignals: StrategySignal[];
  strategyName: string;
  symbolsAvailable: boolean;
  tickerList: string[];
  onAddComparison: () => void;
  onChartModeChange: (mode: ChartMode) => void;
  onClose: () => void;
  onComparisonChange: (id: string, patch: Partial<ComparisonSlot>) => void;
  onHoldSelfStyleChange: (patch: Partial<IndicatorLineStyle>) => void;
  onHoldSelfVisibleChange: (visible: boolean) => void;
  onHoverCandleChange: (candle: Candle | null) => void;
  onRemoveComparison: (id: string) => void;
  onUpdateRunIndicatorLineStyle: (
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) => void;
}) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-xl">{activeRun.ticker}</CardTitle>
          {activeRun.strategy_outdated ? (
            <Badge
              variant="outline"
              className="border-amber-500/60 text-amber-600 dark:text-amber-400"
              title="The strategy's rules have been edited since this run. The results and the rules shown below reflect what actually ran."
            >
              Ran on older rules
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadBacktestCard(activeRun, strategyName)}
          >
            <ShareIcon />
            Share
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <XIcon />
            Close
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-4 sm:px-5">
        <BacktestSection title="Summary">
          <BacktestSummary metrics={metrics} />
        </BacktestSection>

        <Separator />

        <BacktestSection title="Strategy">
          <BacktestStrategyDetails
            activeRun={activeRun}
            strategyName={strategyName}
            definitionsByKind={definitionsByKind}
          />
        </BacktestSection>

        <Separator />

        <BacktestSection
          title="Price & trades"
          action={
            <SlashTabs
              options={chartModeOptions}
              value={chartMode}
              onValueChange={(value) => onChartModeChange(value as ChartMode)}
              aria-label="Chart style"
            />
          }
        >
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
              onHoverCandleChange={onHoverCandleChange}
            />
            <IndicatorLegend
              className="absolute left-2 top-2 z-10 max-w-[75%]"
              indicators={runIndicatorSpecs}
              definitionsByKind={definitionsByKind}
              series={runIndicatorSeries}
              valueTimestampMs={legendTimestampMs}
              onUpdateLineStyle={onUpdateRunIndicatorLineStyle}
            />
          </div>
        </BacktestSection>

        <Separator />

        <BacktestSection title="Equity & benchmarks">
          <EquityChart
            points={activeRun.equity_curve}
            trades={activeRun.trades}
            initialCapital={activeRun.initial_capital}
            timeframe={activeRun.timeframe}
            overlays={equityOverlays}
          />

          <BenchmarkMetrics activeRun={activeRun} metrics={metrics} overlays={equityOverlays} />

          <BacktestComparisons
            activeRun={activeRun}
            comparisonData={comparisonData}
            comparisons={comparisons}
            holdSelfStyle={holdSelfStyle}
            holdSelfVisible={holdSelfVisible}
            maxComparisons={maxComparisons}
            symbolsAvailable={symbolsAvailable}
            tickerList={tickerList}
            onAddComparison={onAddComparison}
            onComparisonChange={onComparisonChange}
            onHoldSelfStyleChange={onHoldSelfStyleChange}
            onHoldSelfVisibleChange={onHoldSelfVisibleChange}
            onRemoveComparison={onRemoveComparison}
          />
        </BacktestSection>

        <Separator />

        <BacktestSection title="Trades">
          <BacktestTradesTable activeRun={activeRun} />
        </BacktestSection>
      </CardContent>
    </Card>
  );
}
