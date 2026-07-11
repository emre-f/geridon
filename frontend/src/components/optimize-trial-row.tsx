import { BookmarkCheckIcon, BookmarkPlusIcon, FlaskConicalIcon, RefreshCwIcon } from "lucide-react";

import type { OptimizationTrialRecord, StrategyRecord } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { trialStatusBadge } from "@/lib/optimize-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const trialsRowGrid =
  "grid min-w-0 flex-1 grid-cols-[2.5rem_4rem_4.5rem_5rem_5rem_4.5rem_3.5rem_4.5rem_5.5rem] items-center gap-x-3";

function formatScore(value: number) {
  return value.toFixed(2);
}

export function OptimizeTrialRow({
  trial,
  baselineScore,
  saving,
  savedStrategy,
  selected,
  onSelect,
  onSave,
  onOpenInBacktest,
}: {
  trial: OptimizationTrialRecord;
  baselineScore: number | null;
  saving: boolean;
  savedStrategy: StrategyRecord | undefined;
  selected: boolean;
  onSelect: (trial: OptimizationTrialRecord) => void;
  onSave: (trial: OptimizationTrialRecord) => void;
  onOpenInBacktest: (trial: OptimizationTrialRecord) => void;
}) {
  const score = trial.score;
  const metrics = trial.metrics;
  const badge = trialStatusBadge(trial);
  const delta = score != null && baselineScore != null ? score.score - baselineScore : null;
  const hasCandidate = trial.status !== "rejected";
  const selectable = trial.status === "scored" || trial.status === "pruned";

  return (
    <div
      className={cn(
        "hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
        selected && "bg-muted/60",
      )}
    >
      <button
        type="button"
        className={cn(trialsRowGrid, "text-left", selectable && "cursor-pointer")}
        disabled={!selectable}
        aria-pressed={selected}
        title={selectable ? "Compare this trial's folds against the baseline" : undefined}
        onClick={() => onSelect(trial)}
      >
        <span className="text-muted-foreground text-xs">
          {trial.rank != null ? `#${trial.rank}` : `t${trial.trial_index}`}
        </span>
        <span className="font-medium tabular-nums">
          {score != null ? formatScore(score.score) : "—"}
        </span>
        <span
          className={
            delta == null
              ? "text-muted-foreground tabular-nums"
              : delta >= 0
                ? "text-emerald-600 tabular-nums dark:text-emerald-400"
                : "text-destructive tabular-nums"
          }
        >
          {delta != null ? `${delta >= 0 ? "+" : ""}${formatScore(delta)}` : "—"}
        </span>
        <span className="tabular-nums">
          {metrics ? formatPercent(metrics.median_return_pct) : "—"}
        </span>
        <span className="tabular-nums">
          {metrics ? formatPercent(metrics.worst_fold_return_pct) : "—"}
        </span>
        <span className="tabular-nums">
          {metrics ? `${metrics.worst_drawdown_pct.toFixed(1)}%` : "—"}
        </span>
        <span className="tabular-nums">{metrics ? metrics.total_trades : "—"}</span>
        <span className="text-muted-foreground tabular-nums">
          {metrics?.median_turnover_ratio != null
            ? metrics.median_turnover_ratio.toFixed(2)
            : "—"}
        </span>
        <span
          className="text-muted-foreground text-xs"
          title={`${trial.complexity.activeRules} active rules · ${trial.complexity.uniqueIndicators} indicators · depth ${trial.complexity.maxDepth}`}
        >
          {trial.complexity.activeRules}r · {trial.complexity.uniqueIndicators}i · d
          {trial.complexity.maxDepth}
        </span>
      </button>

      <div className="flex w-20 shrink-0 items-center">
        <Badge variant={badge.variant} title={badge.title}>
          {badge.label}
        </Badge>
      </div>

      <div className="flex w-16 shrink-0 items-center justify-end gap-1">
        {saving ? (
          <span className="flex size-7 items-center justify-center">
            <RefreshCwIcon className="text-muted-foreground size-3.5 animate-spin" />
          </span>
        ) : hasCandidate ? (
          <>
            {savedStrategy ? (
              <span
                className="text-muted-foreground flex size-7 items-center justify-center"
                title={`Saved as "${savedStrategy.name}"`}
              >
                <BookmarkCheckIcon className="size-3.5" />
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-7"
                aria-label="Save as strategy"
                title="Save as strategy"
                onClick={() => onSave(trial)}
              >
                <BookmarkPlusIcon className="size-3.5" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-7"
              aria-label="Open in Backtest"
              title="Open in Backtest (saves the candidate first)"
              onClick={() => onOpenInBacktest(trial)}
            >
              <FlaskConicalIcon className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
