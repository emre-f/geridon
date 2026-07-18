import { useEffect, useRef, useState } from "react";

import type { StrategySignal } from "@/lib/api";
import type { AppTab } from "@/lib/app-types";
import { AppHeader } from "@/components/app-header";
import { BacktestPanel } from "@/components/backtest-panel";
import { ChartPanel } from "@/components/chart-panel";
import { IndicatorPicker } from "@/components/indicator-picker";
import { OptimizePanel } from "@/components/optimize-panel";
import { SignalsPanel } from "@/components/signals-panel";
import { StrategyBuilder } from "@/components/strategy-builder";
import { SymbolContextMenu as SymbolContextMenuView } from "@/components/symbol-context-menu";
import { SymbolSidebar } from "@/components/symbol-sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { maxActiveIndicators } from "@/hooks/chart-workspace-state";
import { useChartWorkspace } from "@/hooks/use-chart-workspace";
import { useIndicatorCatalog } from "@/hooks/use-indicator-catalog";
import { useStrategyWorkspace } from "@/hooks/use-strategy-workspace";
import { useSymbolManager, type SymbolChartBridge } from "@/hooks/use-symbol-manager";
import { useThemeMode } from "@/hooks/use-theme-mode";

// Stable empty fallback: a fresh [] each render would retrigger the chart's
// signals effect before any data has loaded.
const noSignals: StrategySignal[] = [];

export default function App() {
  const { setTheme, isDark } = useThemeMode();
  const [activeTab, setActiveTab] = useState<AppTab>("charts");
  const [error, setError] = useState<string | null>(null);
  const [backtestStrategyRequest, setBacktestStrategyRequest] = useState<{
    strategyId: number;
  } | null>(null);
  const { catalog, definitionsByKind } = useIndicatorCatalog(setError);

  // The symbol hook reacts to selection changes by calling into the chart
  // hook, which runs after it; the bridge ref breaks that ordering cycle.
  const chartBridge = useRef<SymbolChartBridge | null>(null);
  const symbolManager = useSymbolManager({ chartBridge, onError: setError });
  const chart = useChartWorkspace({
    activeTab,
    selectedSymbol: symbolManager.selectedSymbol,
    selectedTicker: symbolManager.selectedTicker,
    indicatorDefinitionsByKind: definitionsByKind,
    onError: setError,
  });
  const strategy = useStrategyWorkspace({
    activeTab,
    indicatorCatalog: catalog,
    indicatorDefinitionsByKind: definitionsByKind,
    selectedTicker: symbolManager.selectedTicker,
    timeframe: chart.timeframe,
    candleRequestWindow: chart.candleRequestWindow,
  });

  useEffect(() => {
    chartBridge.current = {
      prepareForSymbol: chart.prepareForSymbol,
      restoreChartState: chart.restoreChartState,
      clearCandleData: chart.clearCandleData,
    };
  }, [chart.prepareForSymbol, chart.restoreChartState, chart.clearCandleData]);

  function handleTabChange(value: string) {
    if (!value || value === activeTab) {
      return;
    }

    if (activeTab === "strategies" && !strategy.handleLeaveTab()) {
      return;
    }

    if (value !== "charts") {
      chart.closeIndicatorPicker();
    }
    setActiveTab(value as AppTab);
  }

  function handleOpenInBacktest(strategyId: number) {
    setBacktestStrategyRequest({ strategyId });
    handleTabChange("backtest");
  }

  const showSymbolSidebar = activeTab === "charts" || activeTab === "strategies";

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="flex w-full flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5 2xl:px-6">
        <AppHeader
          activeTab={activeTab}
          isDark={isDark}
          onRefresh={symbolManager.refresh}
          onTabChange={handleTabChange}
          onThemeChange={() => setTheme(isDark ? "light" : "dark")}
        />

        {error ? (
          <Card className="border-destructive/40 bg-destructive/5 py-4">
            <CardContent className="text-destructive text-sm">{error}</CardContent>
          </Card>
        ) : null}

        <div
          className={
            showSymbolSidebar
              ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]"
              : "grid grid-cols-[minmax(0,1fr)] gap-4"
          }
        >
          <div className="flex min-w-0 flex-col gap-4">
            {activeTab === "charts" || activeTab === "strategies" ? (
              <ChartPanel
                activeIndicators={chart.activeIndicators}
                activeTab={activeTab}
                candles={chart.chartCandles}
                candlesLoading={chart.candlesLoading}
                candleWindow={chart.chartCandleWindow}
                chartIndicators={
                  activeTab === "strategies" ? strategy.indicatorsForChart : chart.indicatorsForChart
                }
                chartMode={chart.chartMode}
                chartSignals={activeTab === "strategies" ? strategy.signals : noSignals}
                chartTone={chart.chartTone}
                hasPriceSummary={chart.hasPriceSummary}
                indicatorCatalogLength={catalog.length}
                indicatorDefinitionsByKind={definitionsByKind}
                indicatorSeries={chart.indicatorSeries}
                indicatorsLoading={chart.indicatorsLoading}
                latest={chart.latest}
                legendTimestampMs={chart.legendTimestampMs}
                range={chart.range}
                rangeChange={chart.rangeChange}
                rangePercent={chart.rangePercent}
                selectedSymbol={symbolManager.selectedSymbol}
                selectedTicker={symbolManager.selectedTicker}
                strategyIndicatorSeries={strategy.indicatorSeries}
                strategyIndicatorsLoading={strategy.indicatorsLoading}
                strategyPreviewSpecs={strategy.previewSpecs}
                symbolsLoading={symbolManager.symbolsLoading}
                chartTimeframe={chart.chartTimeframe}
                timeframe={chart.timeframe}
                timeframes={chart.timeframes}
                visibleWindowLabel={chart.visibleWindowLabel}
                onChartModeChange={chart.setChartMode}
                onHoverCandleChange={chart.handleHoverCandleChange}
                onOpenIndicatorPicker={chart.openIndicatorPicker}
                onRangeChange={chart.handleRangeChange}
                onRemoveIndicator={chart.removeIndicator}
                onTimeframeChange={chart.handleTimeframeChange}
                onUpdateIndicatorLineStyle={chart.updateIndicatorLineStyle}
                onUpdateIndicatorParameter={chart.updateIndicatorParameter}
                onUpdateStrategyIndicatorLineStyle={strategy.updateIndicatorLineStyle}
                onVisibleCandlesChange={chart.handleVisibleCandlesChange}
              />
            ) : null}

            {activeTab === "strategies" ? (
              <div className="transition-all duration-200 motion-reduce:transition-none">
                <StrategyBuilder
                  catalog={catalog}
                  strategies={strategy.strategies}
                  selectedId={strategy.selectedId}
                  draft={strategy.draft}
                  dirty={strategy.dirty}
                  loading={strategy.strategiesLoading || !strategy.initialized}
                  saving={strategy.saving}
                  validating={strategy.validating}
                  validation={strategy.validation}
                  error={strategy.error}
                  onDraftChange={strategy.handleDraftChange}
                  onSelectStrategy={strategy.handleSelect}
                  onDuplicate={strategy.handleDuplicate}
                  onDelete={strategy.handleDelete}
                  onValidate={strategy.handleValidate}
                  onSave={strategy.handleSave}
                />
              </div>
            ) : null}

            {/* Kept mounted so the loaded run and comparisons survive tab switches. */}
            <div className={activeTab === "backtest" ? "contents" : "hidden"}>
              <BacktestPanel
                strategies={strategy.strategies}
                initialStrategyId={strategy.selectedId}
                strategyDirty={strategy.dirty}
                symbols={symbolManager.symbols}
                defaultTicker={symbolManager.selectedTicker}
                definitionsByKind={definitionsByKind}
                requestedStrategy={backtestStrategyRequest}
              />
            </div>

            {/* Kept mounted so experiment progress polling survives tab switches. */}
            <div className={activeTab === "optimize" ? "contents" : "hidden"}>
              <OptimizePanel
                strategies={strategy.strategies}
                initialStrategyId={strategy.selectedId}
                symbols={symbolManager.symbols}
                defaultTicker={symbolManager.selectedTicker}
                onStrategySaved={strategy.registerSavedStrategy}
                onOpenInBacktest={handleOpenInBacktest}
              />
            </div>

            {activeTab === "signals" ? <SignalsPanel /> : null}
          </div>

          {showSymbolSidebar ? (
            <SymbolSidebar
              addPanelRef={symbolManager.addPanelRef}
              addTickerInputRef={symbolManager.addTickerInputRef}
              addPanelOpen={symbolManager.addPanelOpen}
              addTickerInput={symbolManager.addTickerInput}
              addingSymbol={symbolManager.addingSymbol}
              deletingTicker={symbolManager.deletingTicker}
              filteredSymbols={symbolManager.filteredSymbols}
              selectedTicker={symbolManager.selectedTicker}
              symbolFilter={symbolManager.symbolFilter}
              symbolsLoading={symbolManager.symbolsLoading}
              visibleSymbols={symbolManager.visibleSymbols}
              onAddPanelOpenChange={symbolManager.setAddPanelOpen}
              onAddTickerInputChange={symbolManager.setAddTickerInput}
              onAddSymbolSubmit={symbolManager.handleAddSymbolSubmit}
              onContextMenu={symbolManager.openSymbolContextMenu}
              onSelectSymbol={symbolManager.selectSymbol}
              onSymbolFilterChange={symbolManager.setSymbolFilter}
            />
          ) : null}
        </div>
      </div>
      <IndicatorPicker
        open={chart.indicatorPickerOpen}
        catalog={catalog}
        activeCount={chart.activeIndicators.length}
        maxCount={maxActiveIndicators}
        onAdd={chart.addIndicator}
        onClose={chart.closeIndicatorPicker}
      />
      {symbolManager.contextMenu ? (
        <SymbolContextMenuView
          menu={symbolManager.contextMenu}
          deletingTicker={symbolManager.deletingTicker}
          onDelete={symbolManager.handleDeleteSymbol}
        />
      ) : null}
    </main>
  );
}
