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
import { formatRanAt, formatRunRange, formatRunSizing, type ComparisonPoint } from "@/lib/backtest-utils";
import { chartModeOptions } from "@/lib/chart-options";
import { downloadBacktestCard } from "@/lib/share-card";
import type { ComparisonSlot } from "@/components/backtest-types";
import { BacktestComparisons } from "@/components/backtest-comparisons";
import { BacktestMetricsGrid } from "@/components/backtest-metrics-grid";
import { BacktestTradesTable } from "@/components/backtest-trades-table";
import { EquityChart, type EquityOverlay } from "@/components/equity-chart";
import { IndicatorLegend } from "@/components/indicator-legend";
import { StockChart, type ChartMode, type ChartTone } from "@/components/stock-chart";
import { StrategyRulesSummary } from "@/components/strategy-rules-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <CardHeader className="flex flex-col gap-3 px-4 sm:px-5">
        <div className="flex w-full flex-col gap-1.5">
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
            <div className="ml-auto flex items-center gap-2">
              <SlashTabs
                options={chartModeOptions}
                value={chartMode}
                onValueChange={(value) => onChartModeChange(value as ChartMode)}
                aria-label="Chart style"
              />
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
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className="text-foreground font-medium">
              <span className="text-muted-foreground font-normal">Strategy </span>
              {strategyName}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatRunRange(activeRun)}</span>
            <span aria-hidden="true">·</span>
            <span>{activeRun.timeframe.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRunSizing(activeRun)}</span>
            <span aria-hidden="true">·</span>
            <span>ran {formatRanAt(activeRun.created_at)}</span>
          </div>
        </div>
        <StrategyRulesSummary
          snapshot={activeRun.strategy_snapshot}
          definitionsByKind={definitionsByKind}
        />
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

        <section className="flex flex-col gap-3" aria-label="Backtest results">
          <BacktestMetricsGrid metrics={metrics} />

          <EquityChart
            points={activeRun.equity_curve}
            trades={activeRun.trades}
            initialCapital={activeRun.initial_capital}
            timeframe={activeRun.timeframe}
            overlays={equityOverlays}
          />

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

          <BacktestTradesTable activeRun={activeRun} />
        </section>
      </CardContent>
    </Card>
  );
}
