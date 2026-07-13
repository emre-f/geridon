import { useMemo } from "react";
import { SearchIcon } from "lucide-react";

import type { StrategyRecord, SymbolSummary } from "@/lib/api";
import { dayEndMs, dayStartMs } from "@/lib/backtest-utils";
import { searchSpaceSize } from "@/lib/optimize-preflight-utils";
import { useOptimizeExperimentForm } from "@/hooks/use-optimize-experiment-form";
import { useOptimizeExperiments } from "@/hooks/use-optimize-experiments";
import { useOptimizePreflight } from "@/hooks/use-optimize-preflight";
import { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { OptimizeExperimentForm } from "@/components/optimize-experiment-form";
import { OptimizePreflightPanel } from "@/components/optimize-preflight-panel";
import { OptimizeSearchSpaceEditor } from "@/components/optimize-search-space-editor";
import { OptimizeExperimentProgressCard } from "@/components/optimize-experiment-progress-card";
import { OptimizeExperimentResultCard } from "@/components/optimize-experiment-result-card";
import { OptimizeExperimentsList } from "@/components/optimize-experiments-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface OptimizePanelProps {
  strategies: StrategyRecord[];
  initialStrategyId: number | null;
  symbols: SymbolSummary[];
  defaultTicker: string;
  onStrategySaved: (record: StrategyRecord) => void;
  onOpenInBacktest: (strategyId: number) => void;
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
  onStrategySaved,
  onOpenInBacktest,
}: OptimizePanelProps) {
  const form = useOptimizeExperimentForm({ strategies, initialStrategyId, symbols, defaultTicker });
  const experiments = useOptimizeExperiments();
  const searchSpace = useOptimizeSearchSpace(form.strategyId);

  const experimentInput = useMemo(() => {
    if (form.strategyId == null || !form.ticker || searchSpace.issue != null || !searchSpace.preview) {
      return null;
    }
    const startMs = dayStartMs(form.startDate);
    const endMs = dayEndMs(form.endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return null;
    }
    return {
      strategy_id: form.strategyId,
      tickers: [form.ticker],
      timeframe: form.timeframe,
      start_ms: startMs,
      end_ms: endMs,
      method: form.method,
      max_trials: form.maxTrials,
      max_runtime_ms: Math.round(form.maxRuntimeMinutes * 60_000),
      folds: { foldCount: form.foldCount, mode: "anchored" as const },
      ...(form.holdoutPct > 0 ? { holdout: { fraction: form.holdoutPct / 100 } } : {}),
      seed: form.seed,
      ...(searchSpace.ruleRoles ? { rule_roles: searchSpace.ruleRoles } : {}),
      ...(searchSpace.parameterOverrides
        ? { parameter_overrides: searchSpace.parameterOverrides }
        : {}),
    };
  }, [
    form.strategyId,
    form.ticker,
    form.timeframe,
    form.startDate,
    form.endDate,
    form.method,
    form.maxTrials,
    form.maxRuntimeMinutes,
    form.foldCount,
    form.holdoutPct,
    form.seed,
    searchSpace.issue,
    searchSpace.preview,
    searchSpace.ruleRoles,
    searchSpace.parameterOverrides,
  ]);

  const preflight = useOptimizePreflight(experimentInput);
  const spaceSize = useMemo(
    () =>
      searchSpace.preview && searchSpace.edits
        ? searchSpaceSize(searchSpace.preview, searchSpace.edits)
        : null,
    [searchSpace.preview, searchSpace.edits],
  );

  async function handleStart() {
    if (experimentInput == null) {
      return;
    }
    await experiments.handleCreate(experimentInput);
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
            Candidates are ranked with walk-forward validation and never applied automatically:
            review the evidence, then save one as a new strategy.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
          {strategies.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Save a strategy in the Strategies tab first; experiments search over a saved
              strategy's parameters and rules.
            </p>
          ) : (
            <>
              <OptimizeExperimentForm
                coverage={form.coverage}
                creating={experiments.creating}
                endDate={form.endDate}
                foldCount={form.foldCount}
                holdoutPct={form.holdoutPct}
                maxRuntimeMinutes={form.maxRuntimeMinutes}
                maxTrials={form.maxTrials}
                method={form.method}
                preset={form.preset}
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
                onHoldoutPctChange={form.setHoldoutPct}
                onMaxRuntimeMinutesChange={form.setMaxRuntimeMinutes}
                onMaxTrialsChange={form.setMaxTrials}
                onMethodChange={form.setMethod}
                onPresetChange={form.setPreset}
                onSeedChange={form.setSeed}
                onStart={handleStart}
                onStartDateChange={form.setStartDate}
                onStrategyIdChange={form.setStrategyId}
                onTickerChange={form.setTicker}
                onTimeframeChange={form.setTimeframe}
                startDisabled={searchSpace.issue != null}
              >
                <OptimizeSearchSpaceEditor searchSpace={searchSpace} />
                <OptimizePreflightPanel
                  preflight={preflight.preflight}
                  loading={preflight.loading}
                  error={preflight.error}
                  spaceSize={spaceSize}
                  maxTrials={form.maxTrials}
                  timeframe={form.timeframe}
                />
              </OptimizeExperimentForm>

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
                  selectedId={experiments.selectedId}
                  onSelect={experiments.handleSelect}
                  onCancel={experiments.handleCancel}
                  onResume={experiments.handleResume}
                  onDelete={experiments.handleDelete}
                />
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {experiments.selectedExperiment ? (
        experiments.selectedExperiment.status === "queued" ||
        experiments.selectedExperiment.status === "running" ? (
          <OptimizeExperimentProgressCard
            experiment={experiments.selectedExperiment}
            actioning={experiments.actioningId === experiments.selectedExperiment.id}
            onCancel={experiments.handleCancel}
            onClose={experiments.closeSelected}
          />
        ) : (
          <OptimizeExperimentResultCard
            experiment={experiments.selectedExperiment}
            onClose={experiments.closeSelected}
            onStrategySaved={onStrategySaved}
            onOpenInBacktest={onOpenInBacktest}
          />
        )
      ) : null}
    </div>
  );
}
