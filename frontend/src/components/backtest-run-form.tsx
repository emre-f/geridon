import { PlayIcon, RefreshCwIcon } from "lucide-react";

import type {
  BacktestPositionMode,
  StrategyRecord,
  SymbolSummary,
  SymbolTimeframe,
} from "@/lib/api";
import { toDateInputValue } from "@/lib/backtest-utils";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";

export function BacktestRunForm({
  buyPercent,
  coverage,
  endDate,
  initialCapital,
  positionMode,
  running,
  selectedSymbol,
  sellPercent,
  startDate,
  strategies,
  strategyId,
  timeframe,
  timeframes,
  tickerList,
  onBuyPercentChange,
  onEndDateChange,
  onInitialCapitalChange,
  onPositionModeChange,
  onRun,
  onSellPercentChange,
  onStartDateChange,
  onStrategyIdChange,
  onTickerChange,
  onTimeframeChange,
}: {
  buyPercent: number;
  coverage: SymbolTimeframe | undefined;
  endDate: string;
  initialCapital: number;
  positionMode: BacktestPositionMode;
  running: boolean;
  selectedSymbol: SymbolSummary | undefined;
  sellPercent: number;
  startDate: string;
  strategies: StrategyRecord[];
  strategyId: number | null;
  timeframe: string;
  timeframes: string[];
  tickerList: string[];
  onBuyPercentChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
  onInitialCapitalChange: (value: number) => void;
  onPositionModeChange: (value: BacktestPositionMode) => void;
  onRun: () => void;
  onSellPercentChange: (value: number) => void;
  onStartDateChange: (value: string) => void;
  onStrategyIdChange: (value: number) => void;
  onTickerChange: (value: string) => void;
  onTimeframeChange: (value: string) => void;
}) {
  const alwaysInMarket = positionMode === "always_in";
  const sizingTitle = alwaysInMarket
    ? "Always in market flips the whole account, so sizing is fixed at 100%."
    : undefined;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Strategy">
        <Select
          value={strategyId == null ? "" : String(strategyId)}
          aria-label="Backtest strategy"
          className="w-48"
          onChange={(event) => onStrategyIdChange(Number(event.target.value))}
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
          onSelect={onTickerChange}
        />
      </Field>
      <Field label="Timeframe">
        <Select
          value={timeframe}
          aria-label="Backtest timeframe"
          className="w-20"
          onChange={(event) => onTimeframeChange(event.target.value)}
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
          onChange={(event) => onStartDateChange(event.target.value)}
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
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </Field>
      <Field label="Mode">
        <Select
          value={positionMode}
          aria-label="Position mode"
          className="w-40"
          onChange={(event) => onPositionModeChange(event.target.value as BacktestPositionMode)}
        >
          <option value="long_only">Long only</option>
          <option value="always_in">Always in market</option>
        </Select>
      </Field>
      <Field label="Buy % of equity">
        <NumberInput
          className="w-24"
          aria-label="Buy percent of equity"
          value={alwaysInMarket ? 100 : buyPercent}
          min={1}
          max={100}
          step={1}
          disabled={alwaysInMarket}
          title={sizingTitle}
          onValueChange={onBuyPercentChange}
        />
      </Field>
      <Field label="Sell % of position">
        <NumberInput
          className="w-24"
          aria-label="Sell percent of position"
          value={alwaysInMarket ? 100 : sellPercent}
          min={1}
          max={100}
          step={1}
          disabled={alwaysInMarket}
          title={sizingTitle}
          onValueChange={onSellPercentChange}
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
          onValueChange={onInitialCapitalChange}
        />
      </Field>
      <Button type="button" onClick={onRun} disabled={running || !selectedSymbol || strategyId == null}>
        {running ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
        Run backtest
      </Button>
    </div>
  );
}
