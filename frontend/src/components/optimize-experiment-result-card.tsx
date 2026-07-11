import { XIcon } from "lucide-react";

import type { OptimizationExperimentListItem, StrategyRecord } from "@/lib/api";
import {
  formatExperimentCreatedAt,
  methodLabels,
  statusBadgeVariant,
  statusLabels,
} from "@/lib/optimize-utils";
import { useOptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
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

      <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
        <OptimizeTrialsLeaderboard board={board} />
      </CardContent>
    </Card>
  );
}
