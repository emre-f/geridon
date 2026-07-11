import { SearchIcon } from "lucide-react";

import type { StrategyRecord, SymbolSummary } from "@/lib/api";
import { dayEndMs, dayStartMs } from "@/lib/backtest-utils";
import { useOptimizeExperimentForm } from "@/hooks/use-optimize-experiment-form";
import { useOptimizeExperiments } from "@/hooks/use-optimize-experiments";
import { OptimizeExperimentForm } from "@/components/optimize-experiment-form";
import { OptimizeExperimentsList } from "@/components/optimize-experiments-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface OptimizePanelProps {
  strategies: StrategyRecord[];
  initialStrategyId: number | null;
  symbols: SymbolSummary[];
  defaultTicker: string;
}

/**
 * The Optimize tab: launch a bounded search over a saved strategy's
 * parameters/rules and track experiment history with out-of-sample evidence.
 */
export function OptimizePanel({
  strategies,
  initialStrategyId,
  symbols,
  defaultTicker,
}: OptimizePanelProps) {
  const form = useOptimizeExperimentForm({ strategies, initialStrategyId, symbols, defaultTicker });
  const experiments = useOptimizeExperiments();

  async function handleStart() {
    if (form.strategyId == null || !form.ticker) {
      return;
    }
    const startMs = dayStartMs(form.startDate);
    const endMs = dayEndMs(form.endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return;
    }
    await experiments.handleCreate({
      strategy_id: form.strategyId,
      tickers: [form.ticker],
      timeframe: form.timeframe,
      start_ms: startMs,
      end_ms: endMs,
      method: form.method,
      max_trials: form.maxTrials,
      max_runtime_ms: Math.round(form.maxRuntimeMinutes * 60_000),
      folds: { foldCount: form.foldCount, mode: "anchored" },
      seed: form.seed,
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="gap-4">
        <CardHeader className="gap-1 px-4 sm:px-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <SearchIcon className="size-5" />
            Strategy Lab
          </CardTitle>
          <CardDescription>
            Search for stronger variants of a saved strategy under a bounded compute budget.
            Candidates are ranked with walk-forward validation, never applied automatically —
            review the evidence, then save one as a new strategy.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
          {strategies.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Save a strategy in the Strategies tab first — experiments search over a saved
              strategy's parameters and rules.
            </p>
          ) : (
            <>
              <OptimizeExperimentForm
                coverage={form.coverage}
                creating={experiments.creating}
                endDate={form.endDate}
                foldCount={form.foldCount}
                maxRuntimeMinutes={form.maxRuntimeMinutes}
                maxTrials={form.maxTrials}
                method={form.method}
                seed={form.seed}
                startDate={form.startDate}
                strategies={strategies}
                strategyId={form.strategyId}
                ticker={form.ticker}
                timeframe={form.timeframe}
                timeframes={form.timeframes}
                tickerList={form.tickerList}
                onEndDateChange={form.setEndDate}
                onFoldCountChange={form.setFoldCount}
                onMaxRuntimeMinutesChange={form.setMaxRuntimeMinutes}
                onMaxTrialsChange={form.setMaxTrials}
                onMethodChange={form.setMethod}
                onSeedChange={form.setSeed}
                onStart={handleStart}
                onStartDateChange={form.setStartDate}
                onStrategyIdChange={form.setStrategyId}
                onTickerChange={form.setTicker}
                onTimeframeChange={form.setTimeframe}
              />

              {experiments.error ? (
                <p className="text-destructive text-sm">{experiments.error}</p>
              ) : null}

              <Separator />

              <section className="flex flex-col gap-2" aria-label="Experiment history">
                <h3 className="text-sm font-medium">Experiments</h3>
                <OptimizeExperimentsList
                  experiments={experiments.experiments}
                  loading={experiments.loading}
                  actioningId={experiments.actioningId}
                  onCancel={experiments.handleCancel}
                  onResume={experiments.handleResume}
                  onDelete={experiments.handleDelete}
                />
              </section>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
