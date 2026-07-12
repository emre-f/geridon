import { useMemo } from "react";
import { XIcon } from "lucide-react";

import type { OptimizationExperimentListItem, StrategyRecord } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { bestScoredTrial, objectiveLabels } from "@/lib/optimize-chart-utils";
import { experimentWarnings } from "@/lib/optimize-warning-utils";
import {
  formatExperimentCreatedAt,
  methodLabels,
  statusBadgeVariant,
  statusLabels,
} from "@/lib/optimize-utils";
import { useOptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import { OptimizeCandidateDetail } from "@/components/optimize-candidate-detail";
import { OptimizeExperimentWarnings } from "@/components/optimize-experiment-warnings";
import { OptimizeHoldoutSection } from "@/components/optimize-holdout-section";
import { OptimizeResultSections } from "@/components/optimize-result-sections";
import { OptimizeStatTiles } from "@/components/optimize-stat-tiles";
import { OptimizeTrialsLeaderboard } from "@/components/optimize-trials-leaderboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const warnings = useMemo(() => {
    const experiment = board.experiment;
    if (!experiment?.summary) {
      return [];
    }
    return experimentWarnings(
      experiment,
      bestScoredTrial(board.trials, experiment.summary.best_trial_index),
    );
  }, [board.experiment, board.trials]);

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

        <OptimizeExperimentWarnings warnings={warnings} />

        {record && summary ? (
          <OptimizeResultSections
            board={board}
            record={record}
            summary={summary}
            candidateLabel={candidateLabel}
          />
        ) : null}

        <OptimizeTrialsLeaderboard board={board} />

        {record && summary && candidateLabel != null ? (
          <OptimizeCandidateDetail
            board={board}
            experimentId={experiment.id}
            space={summary.space}
            timeframe={record.config.timeframe}
            candidateLabel={candidateLabel}
          />
        ) : null}

        {record && summary ? <OptimizeHoldoutSection board={board} record={record} /> : null}
      </CardContent>
    </Card>
  );
}
