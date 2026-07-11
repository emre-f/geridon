import { useMemo } from "react";
import { XIcon } from "lucide-react";

import type { OptimizationExperimentListItem, StrategyRecord } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  decompositionRows,
  foldGroups,
  nodeLabelsById,
  objectiveLabels,
} from "@/lib/optimize-chart-utils";
import {
  formatExperimentCreatedAt,
  methodLabels,
  statusBadgeVariant,
  statusLabels,
} from "@/lib/optimize-utils";
import { useOptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import { OptimizeFoldChart } from "@/components/optimize-fold-chart";
import { OptimizeScoreDecomposition } from "@/components/optimize-score-decomposition";
import { OptimizeStatTiles } from "@/components/optimize-stat-tiles";
import { OptimizeTraceChart } from "@/components/optimize-trace-chart";
import { OptimizeTrialsLeaderboard } from "@/components/optimize-trials-leaderboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function ChartSection({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{question}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Results for one selected experiment, shown below the Strategy Lab card the
 * same way Backtest shows an opened run.
 */
export function OptimizeExperimentResultCard({
  experiment,
  onClose,
  onStrategySaved,
  onOpenInBacktest,
}: {
  experiment: OptimizationExperimentListItem;
  onClose: () => void;
  onStrategySaved: (record: StrategyRecord) => void;
  onOpenInBacktest: (strategyId: number) => void;
}) {
  const board = useOptimizeExperimentDetail({
    experimentId: experiment.id,
    onStrategySaved,
    onOpenInBacktest,
  });

  const record = board.experiment;
  const summary = record?.summary ?? null;
  const objectiveLabel = objectiveLabels[record?.config.scoring?.objective ?? "sharpe"];

  const labelById = useMemo(() => nodeLabelsById(summary?.space ?? []), [summary]);
  const valuesByTrial = useMemo(
    () =>
      new Map(
        board.trials
          .filter((trial) => trial.score != null)
          .map((trial) => [trial.trial_index, trial.values]),
      ),
    [board.trials],
  );
  const decomposition = useMemo(
    () => (summary ? decompositionRows(summary, board.trials) : []),
    [summary, board.trials],
  );
  const folds = useMemo(
    () =>
      summary
        ? foldGroups(
            summary.baseline.foldResults,
            summary.buy_hold.foldResults,
            board.selectedTrialDetail?.fold_results ?? null,
          )
        : [],
    [summary, board.selectedTrialDetail],
  );
  const candidateLabel =
    board.selectedTrialDetail && board.selectedTrial
      ? board.selectedTrial.rank != null
        ? `#${board.selectedTrial.rank} · trial ${board.selectedTrial.trial_index}`
        : `Trial ${board.selectedTrial.trial_index}`
      : null;

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-4 sm:px-5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl">{experiment.strategy_name}</CardTitle>
            <Badge variant={statusBadgeVariant[experiment.status]}>
              {statusLabels[experiment.status]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {experiment.tickers.join(", ")} · {experiment.timeframe.toUpperCase()} ·{" "}
            {methodLabels[experiment.method]} · started{" "}
            {formatExperimentCreatedAt(experiment.created_at)}
            {record
              ? ` · ${formatDate(record.config.start_ms, "1d")} – ${formatDate(record.config.end_ms, "1d")} · ${record.config.folds.foldCount} ${record.config.folds.mode} folds · ${objectiveLabel} objective · seed ${record.config.seed}`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onClose}
        >
          <XIcon />
          Close
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 px-4 sm:px-5">
        {board.loading && !record ? (
          <p className="text-muted-foreground text-sm">Loading experiment results…</p>
        ) : null}

        {record && summary ? <OptimizeStatTiles experiment={record} trials={board.trials} /> : null}

        {board.trace.length > 0 ? (
          <ChartSection title="Search trace" question="Did the search improve on the baseline?">
            <OptimizeTraceChart
              points={board.trace}
              baselineScore={board.baselineScore}
              valuesByTrial={valuesByTrial}
              labelById={labelById}
            />
          </ChartSection>
        ) : null}

        {decomposition.length > 0 ? (
          <ChartSection
            title="Score decomposition"
            question="Which penalties pull each candidate's score down?"
          >
            <OptimizeScoreDecomposition rows={decomposition} />
          </ChartSection>
        ) : null}

        {folds.length > 0 ? (
          <ChartSection
            title="Fold robustness"
            question={`Does the ${objectiveLabel} objective survive every validation fold?`}
          >
            <OptimizeFoldChart
              groups={folds}
              candidateLabel={candidateLabel}
              objectiveLabel={objectiveLabel}
            />
            <p className="text-muted-foreground px-1 text-xs">
              {board.trialDetailLoading
                ? "Loading the selected trial's folds…"
                : candidateLabel == null
                  ? "Select a scored trial in the leaderboard to compare its folds against the baseline."
                  : null}
            </p>
          </ChartSection>
        ) : null}

        <OptimizeTrialsLeaderboard board={board} />
      </CardContent>
    </Card>
  );
}
