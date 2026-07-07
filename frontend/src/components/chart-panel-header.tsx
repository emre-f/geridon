import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";

import type { Candle, SymbolSummary } from "@/lib/api";
import {
  chartModeOptions,
  rangeOptions,
  timeframeOptions,
} from "@/lib/chart-options";
import {
  formatAbsolutePercent,
  formatCompactCurrency,
  formatCurrency,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChartMode, ChartTone } from "@/components/stock-chart";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SlashTabs } from "@/components/ui/slash-tabs";

function formatSignedCompactCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${formatCompactCurrency(value)}`;
}

function PriceSummary({
  chartTone,
  range,
  rangeChange,
  rangePercent,
}: {
  chartTone: ChartTone;
  range: string;
  rangeChange: number;
  rangePercent: number;
}) {
  const priceSummaryClass =
    chartTone === "down"
      ? "bg-[var(--chart-down-muted)] text-[var(--chart-down)]"
      : "bg-[var(--chart-up-muted)] text-[var(--chart-up)]";

  return (
    <div
      className={cn(
        "inline-flex min-w-fit shrink-0 items-center gap-1.5 text-base font-semibold leading-none",
        chartTone === "down" ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]",
      )}
    >
      <span className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2", priceSummaryClass)}>
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
  );
}

export function ChartPanelHeader({
  activeChart,
  candlesLoading,
  chartMode,
  chartTone,
  hasPriceSummary,
  indicatorCatalogLength,
  latest,
  range,
  rangeChange,
  rangePercent,
  selectedSymbol,
  selectedTicker,
  symbolsLoading,
  timeframe,
  timeframes,
  visibleWindowLabel,
  onChartModeChange,
  onOpenIndicatorPicker,
  onRangeChange,
  onTimeframeChange,
}: {
  activeChart: boolean;
  candlesLoading: boolean;
  chartMode: ChartMode;
  chartTone: ChartTone;
  hasPriceSummary: boolean;
  indicatorCatalogLength: number;
  latest: Candle | undefined;
  range: string;
  rangeChange: number;
  rangePercent: number;
  selectedSymbol: SymbolSummary | undefined;
  selectedTicker: string;
  symbolsLoading: boolean;
  timeframe: string;
  timeframes: string[];
  visibleWindowLabel: string | null;
  onChartModeChange: (mode: ChartMode) => void;
  onOpenIndicatorPicker: () => void;
  onRangeChange: (value: string) => void;
  onTimeframeChange: (value: string) => void;
}) {
  return (
    <CardHeader className="flex flex-col gap-4 px-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {activeChart ? (
          <Button
            type="button"
            variant="outline"
            onClick={onOpenIndicatorPicker}
            disabled={indicatorCatalogLength === 0}
          >
            <PlusIcon />
            Indicators
          </Button>
        ) : null}

        <SlashTabs
          options={chartModeOptions}
          value={chartMode}
          onValueChange={(value) => onChartModeChange(value as ChartMode)}
          aria-label="Chart style"
        />
        <SlashTabs
          options={timeframeOptions.map((option) => ({
            ...option,
            disabled: !timeframes.includes(option.value),
          }))}
          value={timeframe}
          onValueChange={onTimeframeChange}
          aria-label="Candle timeframe"
        />
        <SlashTabs
          options={rangeOptions}
          value={range}
          onValueChange={onRangeChange}
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
                className="text-muted-foreground/50 shrink-0 select-none text-xl"
              >
                /
              </span>
              <Skeleton className="h-8 w-full max-w-[28rem]" />
            </>
          ) : hasPriceSummary && latest ? (
            <>
              <span
                aria-hidden="true"
                className="text-muted-foreground/50 shrink-0 select-none text-xl"
              >
                /
              </span>
              <div className="shrink-0 text-[clamp(1.5rem,4vw,1.875rem)] font-medium leading-none tracking-normal text-foreground">
                {formatCurrency(latest.close)}
              </div>
              <PriceSummary
                chartTone={chartTone}
                range={range}
                rangeChange={rangeChange}
                rangePercent={rangePercent}
              />
              {visibleWindowLabel && selectedSymbol ? (
                <span className="text-muted-foreground min-w-0 truncate text-sm">
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
  );
}
