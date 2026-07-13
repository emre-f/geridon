import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

import type { OptimizationExperimentListItem } from "@/lib/api";
import { formatDuration } from "@/lib/optimize-chart-utils";
import { experimentProgressView } from "@/lib/optimize-progress-utils";
import {
  canCancel,
  formatExperimentCreatedAt,
  methodLabels,
  statusBadgeVariant,
  statusLabels,
} from "@/lib/optimize-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function useNowMs(enabled: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [enabled]);
  return nowMs;
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-muted/30 flex flex-col gap-0.5 rounded-md p-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="flex flex-col">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {detail ? <span className="text-muted-foreground/70 text-[11px]">{detail}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Live view of a queued/running experiment, shown below the Strategy Lab card
 * until results replace it. Data refreshes with the history list's polling.
 */
export function OptimizeExperimentProgressCard({
  experiment,
  actioning,
  onCancel,
  onClose,
}: {
  experiment: OptimizationExperimentListItem;
  actioning: boolean;
  onCancel: (experiment: OptimizationExperimentListItem) => void;
  onClose: () => void;
}) {
  const nowMs = useNowMs(experiment.status === "running");
  const view = experimentProgressView(experiment, nowMs);

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
        <div className="flex items-center gap-1">
          {canCancel(experiment.status) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actioning}
              onClick={() => onCancel(experiment)}
            >
              {actioning ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
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
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 sm:px-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{view.stageLabel}</span>
            <span className="text-muted-foreground tabular-nums text-xs">
              {view.evaluated}/{view.maxTrials} trials
            </span>
          </div>
          <div
            className="bg-accent h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={view.maxTrials}
            aria-valuenow={view.evaluated}
            aria-label="Evaluated trials"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${Math.round(view.fraction * 100)}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Elapsed"
            value={view.elapsedMs != null ? formatDuration(view.elapsedMs) : "—"}
          />
          <Tile
            label="Runtime budget left"
            value={view.runtimeRemainingMs != null ? formatDuration(view.runtimeRemainingMs) : "—"}
            detail={`cap ${formatDuration(experiment.max_runtime_ms)}`}
          />
          <Tile label="Trials left" value={String(view.trialsRemaining)} />
          <Tile label="Scored" value={view.counts ? String(view.counts.scored) : "—"} />
          <Tile
            label="Pruned / rejected"
            value={view.counts ? `${view.counts.pruned} / ${view.counts.rejected}` : "—"}
            detail="halving prunes, invalid rejects"
          />
          <Tile
            label="Baseline score"
            value={view.baselineScore != null ? view.baselineScore.toFixed(2) : "—"}
            detail="candidates must beat this"
          />
        </dl>

        <p className="text-muted-foreground text-xs">
          Results appear here as soon as the run finishes. Stopping keeps every completed trial.
        </p>
      </CardContent>
    </Card>
  );
}
