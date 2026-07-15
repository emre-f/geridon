import { useMemo } from "react";
import { SearchIcon } from "lucide-react";

import type { StrategyRecord, SymbolSummary } from "@/lib/api";
import { searchSpaceSize } from "@/lib/optimize-preflight-utils";
import { scoringIssue } from "@/lib/optimize-scoring-utils";
import { useOptimizeExperimentForm, type SearchMode } from "@/hooks/use-optimize-experiment-form";
import { useOptimizeExperimentInput } from "@/hooks/use-optimize-experiment-input";
import { useOptimizeExperiments } from "@/hooks/use-optimize-experiments";
import { useOptimizePreflight } from "@/hooks/use-optimize-preflight";
import { useOptimizeRuleLibrary } from "@/hooks/use-optimize-rule-library";
import { useOptimizeSearchSpace } from "@/hooks/use-optimize-search-space";
import { OptimizeExperimentForm } from "@/components/optimize-experiment-form";
import { OptimizePreflightPanel } from "@/components/optimize-preflight-panel";
import { OptimizeScoringFields } from "@/components/optimize-scoring-fields";
import { OptimizeRuleLibraryEditor } from "@/components/optimize-rule-library-editor";
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
  const evolving = form.mode === "explore";
  const tuneOnly = form.mode === "tune";
  const ruleLibrary = useOptimizeRuleLibrary(form.strategyId, evolving);
  const experimentInput = useOptimizeExperimentInput(form, searchSpace, ruleLibrary);

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

  function handleModeChange(mode: SearchMode) {
    form.setMode(mode);
    if (mode === "tune") {
      searchSpace.resetRoles();
    }
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
                mode={form.mode}
                preset={form.preset}
                seed={form.seed}
                startDate={form.startDate}
                strategies={strategies}
                strategyId={form.strategyId}
                ticker={form.ticker}
                timeframe={form.timeframe}
                timeframes={form.timeframes}
                tickerList={form.tickerList}
                workerCount={form.workerCount}
                onEndDateChange={form.setEndDate}
                onFoldCountChange={form.setFoldCount}
                onHoldoutPctChange={form.setHoldoutPct}
                onMaxRuntimeMinutesChange={form.setMaxRuntimeMinutes}
                onMaxTrialsChange={form.setMaxTrials}
                onMethodChange={form.setMethod}
                onModeChange={handleModeChange}
                onPresetChange={form.setPreset}
                onSeedChange={form.setSeed}
                onStart={handleStart}
                onStartDateChange={form.setStartDate}
                onStrategyIdChange={form.setStrategyId}
                onTickerChange={form.setTicker}
                onTimeframeChange={form.setTimeframe}
                onWorkerCountChange={form.setWorkerCount}
                startDisabled={
                  searchSpace.issue != null ||
                  (evolving && ruleLibrary.issue != null) ||
                  scoringIssue(form.scoring) != null ||
                  preflight.error != null
                }
              >
                <OptimizeSearchSpaceEditor searchSpace={searchSpace} rolesEditable={!tuneOnly} />
                {evolving ? <OptimizeRuleLibraryEditor ruleLibrary={ruleLibrary} /> : null}
                <OptimizeScoringFields scoring={form.scoring} onScoringChange={form.setScoring} />
                <OptimizePreflightPanel
                  preflight={preflight.preflight}
                  loading={preflight.loading}
                  error={preflight.error}
                  spaceSize={spaceSize}
                  maxTrials={form.maxTrials}
                  timeframe={form.timeframe}
                />
              </OptimizeExperimentForm>

              {experiments.error && experiments.error !== preflight.error ? (
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
