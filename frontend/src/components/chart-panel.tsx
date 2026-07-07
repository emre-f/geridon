import type { AppTab } from "@/lib/app-types";
import type {
  Candle,
  IndicatorDefinition,
  IndicatorKind,
  IndicatorLineStyle,
  IndicatorParameterDefinition,
  IndicatorSeries,
  IndicatorSpec,
  StrategySignal,
  SymbolSummary,
} from "@/lib/api";
import { ChartPanelHeader } from "@/components/chart-panel-header";
import { IndicatorLegend } from "@/components/indicator-legend";
import { StockChart, type ChartMode, type ChartTone } from "@/components/stock-chart";
import { Card, CardContent } from "@/components/ui/card";

export function ChartPanel({
  activeIndicators,
  activeTab,
  candles,
  candlesLoading,
  candleWindow,
  chartIndicators,
  chartMode,
  chartSignals,
  chartTone,
  hasPriceSummary,
  indicatorCatalogLength,
  indicatorDefinitionsByKind,
  indicatorSeries,
  indicatorsLoading,
  latest,
  legendTimestampMs,
  range,
  rangeChange,
  rangePercent,
  selectedSymbol,
  selectedTicker,
  strategyIndicatorSeries,
  strategyIndicatorsLoading,
  strategyPreviewSpecs,
  symbolsLoading,
  timeframe,
  timeframes,
  visibleWindowLabel,
  onChartModeChange,
  onHoverCandleChange,
  onOpenIndicatorPicker,
  onRangeChange,
  onRemoveIndicator,
  onTimeframeChange,
  onUpdateIndicatorLineStyle,
  onUpdateIndicatorParameter,
  onUpdateStrategyIndicatorLineStyle,
  onVisibleCandlesChange,
}: {
  activeIndicators: IndicatorSpec[];
  activeTab: AppTab;
  candles: Candle[];
  candlesLoading: boolean;
  candleWindow?: { startMs: number; endMs: number };
  chartIndicators: IndicatorSeries[];
  chartMode: ChartMode;
  chartSignals: StrategySignal[];
  chartTone: ChartTone;
  hasPriceSummary: boolean;
  indicatorCatalogLength: number;
  indicatorDefinitionsByKind: Map<IndicatorKind, IndicatorDefinition>;
  indicatorSeries: IndicatorSeries[];
  indicatorsLoading: boolean;
  latest: Candle | undefined;
  legendTimestampMs: number | null;
  range: string;
  rangeChange: number;
  rangePercent: number;
  selectedSymbol: SymbolSummary | undefined;
  selectedTicker: string;
  strategyIndicatorSeries: IndicatorSeries[];
  strategyIndicatorsLoading: boolean;
  strategyPreviewSpecs: IndicatorSpec[];
  symbolsLoading: boolean;
  timeframe: string;
  timeframes: string[];
  visibleWindowLabel: string | null;
  onChartModeChange: (mode: ChartMode) => void;
  onHoverCandleChange: (candle: Candle | null) => void;
  onOpenIndicatorPicker: () => void;
  onRangeChange: (value: string) => void;
  onRemoveIndicator: (id: string) => void;
  onTimeframeChange: (value: string) => void;
  onUpdateIndicatorLineStyle: (
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) => void;
  onUpdateIndicatorParameter: (
    id: string,
    parameter: IndicatorParameterDefinition,
    nextValue: number,
  ) => void;
  onUpdateStrategyIndicatorLineStyle: (
    id: string,
    slotIndex: number,
    patch: Partial<IndicatorLineStyle>,
  ) => void;
  onVisibleCandlesChange: (candles: Candle[]) => void;
}) {
  return (
    <Card className="gap-4">
      <ChartPanelHeader
        activeChart={activeTab === "charts"}
        candlesLoading={candlesLoading}
        chartMode={chartMode}
        chartTone={chartTone}
        hasPriceSummary={hasPriceSummary}
        indicatorCatalogLength={indicatorCatalogLength}
        latest={latest}
        range={range}
        rangeChange={rangeChange}
        rangePercent={rangePercent}
        selectedSymbol={selectedSymbol}
        selectedTicker={selectedTicker}
        symbolsLoading={symbolsLoading}
        timeframe={timeframe}
        timeframes={timeframes}
        visibleWindowLabel={visibleWindowLabel}
        onChartModeChange={onChartModeChange}
        onOpenIndicatorPicker={onOpenIndicatorPicker}
        onRangeChange={onRangeChange}
        onTimeframeChange={onTimeframeChange}
      />

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
            onVisibleCandlesChange={onVisibleCandlesChange}
            onHoverCandleChange={onHoverCandleChange}
          />
          {activeTab === "strategies" ? (
            <IndicatorLegend
              className="absolute left-2 top-2 z-10 max-w-[75%] transition-opacity duration-200 motion-reduce:transition-none"
              indicators={strategyPreviewSpecs}
              definitionsByKind={indicatorDefinitionsByKind}
              series={strategyIndicatorSeries}
              valueTimestampMs={legendTimestampMs}
              onUpdateLineStyle={onUpdateStrategyIndicatorLineStyle}
            />
          ) : (
            <IndicatorLegend
              className="absolute left-2 top-2 z-10 max-w-[75%] transition-opacity duration-200 motion-reduce:transition-none"
              indicators={activeIndicators}
              definitionsByKind={indicatorDefinitionsByKind}
              series={indicatorSeries}
              valueTimestampMs={legendTimestampMs}
              onUpdateParameter={onUpdateIndicatorParameter}
              onUpdateLineStyle={onUpdateIndicatorLineStyle}
              onRemove={onRemoveIndicator}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
