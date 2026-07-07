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
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

function PositionModeHelp() {
  return (
    <HelpTip ariaLabel="Position mode descriptions">
      <span className="block leading-snug">
        <span className="font-medium">Long only</span>
        {": "}
        <span className="text-muted-foreground">
          buy signals open a position and sell signals close it; the account sits in cash between
          trades. Sizing uses the buy/sell % fields.
        </span>
      </span>
      <span className="mt-1 block leading-snug">
        <span className="font-medium">Always in market</span>
        {": "}
        <span className="text-muted-foreground">
          every signal flips the whole account 100% long or 100% short (cash-secured, no leverage or borrow costs).
        </span>
      </span>
    </HelpTip>
  );
}

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex flex-col gap-3">
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
              className="w-48"
              onSelect={onTickerChange}
            />
          </Field>
        </div>

        <Separator orientation="vertical" className="hidden h-auto sm:block" />

        <div className="flex flex-col gap-3">
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
          <div className="flex items-end gap-3">
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
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-auto sm:block" />

        <div className="flex flex-col gap-3">
          <Field label="Mode" labelExtra={<PositionModeHelp />}>
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
          <div className="flex items-end gap-3">
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
          </div>
        </div>
      </div>

      <div>
        <Button type="button" onClick={onRun} disabled={running || !selectedSymbol || strategyId == null}>
          {running ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
          Run backtest
        </Button>
      </div>
    </div>
  );
}
