import type { ReactNode } from "react";
import { PlayIcon, RefreshCwIcon } from "lucide-react";

import type { OptimizationMethod, StrategyRecord, SymbolTimeframe } from "@/lib/api";
import { toDateInputValue } from "@/lib/backtest-utils";
import type { BudgetPreset, BudgetPresetChoice } from "@/lib/optimize-preflight-utils";
import type { SearchMode } from "@/hooks/use-optimize-experiment-form";
import { OptimizeBudgetFields } from "@/components/optimize-budget-fields";
import { OptimizeModeField } from "@/components/optimize-mode-field";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export function OptimizeExperimentForm({
  children,
  coverage,
  creating,
  endDate,
  foldCount,
  holdoutPct,
  maxRuntimeMinutes,
  maxTrials,
  method,
  mode,
  preset,
  seed,
  startDate,
  startDisabled,
  strategies,
  strategyId,
  ticker,
  timeframe,
  timeframes,
  tickerList,
  workerCount,
  onEndDateChange,
  onFoldCountChange,
  onHoldoutPctChange,
  onMaxRuntimeMinutesChange,
  onMaxTrialsChange,
  onMethodChange,
  onModeChange,
  onPresetChange,
  onSeedChange,
  onStart,
  onStartDateChange,
  onStrategyIdChange,
  onTickerChange,
  onTimeframeChange,
  onWorkerCountChange,
}: {
  children?: ReactNode;
  coverage: SymbolTimeframe | undefined;
  creating: boolean;
  endDate: string;
  foldCount: number;
  holdoutPct: number;
  maxRuntimeMinutes: number;
  maxTrials: number;
  method: OptimizationMethod;
  mode: SearchMode;
  preset: BudgetPresetChoice;
  seed: number;
  startDate: string;
  startDisabled?: boolean;
  strategies: StrategyRecord[];
  strategyId: number | null;
  ticker: string;
  timeframe: string;
  timeframes: string[];
  tickerList: string[];
  workerCount: number;
  onEndDateChange: (value: string) => void;
  onFoldCountChange: (value: number) => void;
  onHoldoutPctChange: (value: number) => void;
  onMaxRuntimeMinutesChange: (value: number) => void;
  onMaxTrialsChange: (value: number) => void;
  onMethodChange: (value: OptimizationMethod) => void;
  onModeChange: (value: SearchMode) => void;
  onPresetChange: (value: BudgetPreset) => void;
  onSeedChange: (value: number) => void;
  onStart: () => void;
  onStartDateChange: (value: string) => void;
  onStrategyIdChange: (value: number) => void;
  onTickerChange: (value: string) => void;
  onTimeframeChange: (value: string) => void;
  onWorkerCountChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex flex-col gap-3">
          <Field label="Strategy">
            <Select
              value={strategyId == null ? "" : String(strategyId)}
              aria-label="Optimize strategy"
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
          <OptimizeModeField mode={mode} onModeChange={onModeChange} />
          <Field label="Symbol">
            <SymbolCombobox
              value={ticker}
              tickers={tickerList}
              ariaLabel="Optimize symbol"
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
              aria-label="Optimize timeframe"
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
                aria-label="Optimize start date"
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
                aria-label="Optimize end date"
                className="w-36"
                min={startDate || undefined}
                max={coverage ? toDateInputValue(coverage.end_ms) : undefined}
                onChange={(event) => onEndDateChange(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-auto sm:block" />

        <OptimizeBudgetFields
          foldCount={foldCount}
          holdoutPct={holdoutPct}
          maxTrials={maxTrials}
          method={method}
          preset={preset}
          workerCount={workerCount}
          onFoldCountChange={onFoldCountChange}
          onHoldoutPctChange={onHoldoutPctChange}
          onMaxTrialsChange={onMaxTrialsChange}
          onMethodChange={onMethodChange}
          onPresetChange={onPresetChange}
          onWorkerCountChange={onWorkerCountChange}
        />

        <Separator orientation="vertical" className="hidden h-auto sm:block" />

        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <Field label="Max runtime (min)">
              <NumberInput
                className="w-24"
                aria-label="Max runtime minutes"
                value={maxRuntimeMinutes}
                min={0.1}
                max={30}
                step={0.5}
                onValueChange={onMaxRuntimeMinutesChange}
              />
            </Field>
            <Field label="Seed">
              <NumberInput
                className="w-20"
                aria-label="Random seed"
                value={seed}
                min={0}
                max={1_000_000}
                step={1}
                onValueChange={onSeedChange}
              />
            </Field>
          </div>
        </div>
      </div>

      {children}

      <div>
        <Button
          type="button"
          onClick={onStart}
          disabled={creating || strategyId == null || !ticker || startDisabled}
        >
          {creating ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
          Start experiment
        </Button>
      </div>
    </div>
  );
}
