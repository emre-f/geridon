import { PlusIcon, XIcon } from "lucide-react";

import type { BacktestRunRecord, IndicatorLineStyle } from "@/lib/api";
import { comparisonCacheKey, type ComparisonPoint } from "@/lib/backtest-utils";
import type { ComparisonSlot } from "@/components/backtest-types";
import { ColorPicker } from "@/components/color-picker";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Button } from "@/components/ui/button";

export function BacktestComparisons({
  activeRun,
  comparisonData,
  comparisons,
  holdSelfStyle,
  holdSelfVisible,
  maxComparisons,
  symbolsAvailable,
  tickerList,
  onAddComparison,
  onComparisonChange,
  onHoldSelfStyleChange,
  onHoldSelfVisibleChange,
  onRemoveComparison,
}: {
  activeRun: BacktestRunRecord;
  comparisonData: Record<string, ComparisonPoint[]>;
  comparisons: ComparisonSlot[];
  holdSelfStyle: IndicatorLineStyle;
  holdSelfVisible: boolean;
  maxComparisons: number;
  symbolsAvailable: boolean;
  tickerList: string[];
  onAddComparison: () => void;
  onComparisonChange: (id: string, patch: Partial<ComparisonSlot>) => void;
  onHoldSelfStyleChange: (patch: Partial<IndicatorLineStyle>) => void;
  onHoldSelfVisibleChange: (visible: boolean) => void;
  onRemoveComparison: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="PnL comparisons">
      <span className="text-muted-foreground text-xs font-medium">Compare</span>

      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--primary)]"
          checked={holdSelfVisible}
          aria-label={`Show hold ${activeRun.ticker}`}
          onChange={(event) => onHoldSelfVisibleChange(event.target.checked)}
        />
        <ColorPicker
          value={holdSelfStyle.color}
          ariaLabel={`Hold ${activeRun.ticker} color and line style`}
          lineStyle={{
            stroke: holdSelfStyle.stroke,
            width: holdSelfStyle.width,
            opacity: holdSelfStyle.opacity,
          }}
          onChange={(color) => onHoldSelfStyleChange({ color })}
          onLineStyleChange={onHoldSelfStyleChange}
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
