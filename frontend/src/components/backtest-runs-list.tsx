import { RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { BacktestRunSummary } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { formatRanAt, formatRunRange } from "@/lib/backtest-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function BacktestRunsList({
  activeRunId,
  openingRunId,
  runs,
  runsLoading,
  onDeleteRun,
  onOpenRun,
}: {
  activeRunId: number | undefined;
  openingRunId: number | null;
  runs: BacktestRunSummary[];
  runsLoading: boolean;
  onDeleteRun: (run: BacktestRunSummary) => void;
  onOpenRun: (run: BacktestRunSummary) => void;
}) {
  if (runsLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (runs.length === 0) {
    return <p className="text-muted-foreground text-sm">No runs yet for this strategy.</p>;
  }

  return (
    <div className="flex flex-col">
      {runs.map((run) => (
        <div
          key={run.id}
          className={cn(
            "hover:bg-muted/50 group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
            activeRunId === run.id && "bg-muted/60",
          )}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-left"
            onClick={() => onOpenRun(run)}
          >
            <span className="text-muted-foreground w-28 shrink-0 text-xs">
              {formatRanAt(run.created_at)}
            </span>
            <span className="w-14 shrink-0 font-medium">{run.ticker}</span>
            <span className="text-muted-foreground w-8 shrink-0 text-xs">
              {run.timeframe.toUpperCase()}
            </span>
            {run.position_mode === "always_in" ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                L/S
              </Badge>
            ) : null}
            <span className="text-muted-foreground text-xs">{formatRunRange(run)}</span>
            <span
              className={cn(
                "ml-auto font-medium",
                run.metrics.total_return_pct < 0
                  ? "text-[var(--chart-down)]"
                  : "text-[var(--chart-up)]",
              )}
            >
              {formatPercent(run.metrics.total_return_pct)}
            </span>
            {openingRunId === run.id ? (
              <RefreshCwIcon className="text-muted-foreground size-3.5 animate-spin" />
            ) : null}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Delete run"
            onClick={() => onDeleteRun(run)}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
