import { PlusIcon, XIcon } from "lucide-react";

import type { BacktestRunRecord, IndicatorLineStyle } from "@/lib/api";
import { comparisonCacheKey, type ComparisonPoint } from "@/lib/backtest-utils";
import type { BenchmarkId, BenchmarkView, ComparisonSlot } from "@/components/backtest-types";
import { ColorPicker } from "@/components/color-picker";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Button } from "@/components/ui/button";

export function BacktestComparisons({
  activeRun,
  benchmarks,
  comparisonData,
  comparisons,
  maxComparisons,
  symbolsAvailable,
  tickerList,
  onAddComparison,
  onBenchmarkStyleChange,
  onBenchmarkVisibleChange,
  onComparisonChange,
  onRemoveComparison,
}: {
  activeRun: BacktestRunRecord;
  benchmarks: BenchmarkView[];
  comparisonData: Record<string, ComparisonPoint[]>;
  comparisons: ComparisonSlot[];
  maxComparisons: number;
  symbolsAvailable: boolean;
  tickerList: string[];
  onAddComparison: () => void;
  onBenchmarkStyleChange: (id: BenchmarkId, patch: Partial<IndicatorLineStyle>) => void;
  onBenchmarkVisibleChange: (id: BenchmarkId, visible: boolean) => void;
  onComparisonChange: (id: string, patch: Partial<ComparisonSlot>) => void;
  onRemoveComparison: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="PnL comparisons">
      <span className="text-muted-foreground text-xs font-medium">Compare</span>

      {benchmarks.map((benchmark) => (
        <label key={benchmark.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            checked={benchmark.visible}
            aria-label={`Show ${benchmark.label} benchmark`}
            onChange={(event) => onBenchmarkVisibleChange(benchmark.id, event.target.checked)}
          />
          <ColorPicker
            value={benchmark.style.color}
            ariaLabel={`${benchmark.label} benchmark color and line style`}
            lineStyle={{
              stroke: benchmark.style.stroke,
              width: benchmark.style.width,
              opacity: benchmark.style.opacity,
            }}
            onChange={(color) => onBenchmarkStyleChange(benchmark.id, { color })}
            onLineStyleChange={(patch) => onBenchmarkStyleChange(benchmark.id, patch)}
          />
          <span title={benchmark.title}>{benchmark.label}</span>
        </label>
      ))}

      {comparisons.map((slot) => (
        <div key={slot.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            checked={slot.visible}
            aria-label={`Show ${slot.ticker} comparison`}
            onChange={(event) => onComparisonChange(slot.id, { visible: event.target.checked })}
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
              onComparisonChange(slot.id, { style: { ...slot.style, color } })
            }
            onLineStyleChange={(patch) =>
              onComparisonChange(slot.id, { style: { ...slot.style, ...patch } })
            }
          />
          <SymbolCombobox
            value={slot.ticker}
            tickers={tickerList}
            ariaLabel="Comparison symbol"
            className="w-28"
            onSelect={(nextTicker) => onComparisonChange(slot.id, { ticker: nextTicker })}
          />
          {slot.visible && comparisonData[comparisonCacheKey(slot.ticker, activeRun)]?.length === 0 ? (
            <span className="text-muted-foreground text-xs">(no data)</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            aria-label={`Remove ${slot.ticker} comparison`}
            onClick={() => onRemoveComparison(slot.id)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ))}

      {comparisons.length < maxComparisons && symbolsAvailable ? (
        <Button type="button" variant="outline" size="sm" onClick={onAddComparison}>
          <PlusIcon />
          Add comparison
        </Button>
      ) : null}
    </div>
  );
}
