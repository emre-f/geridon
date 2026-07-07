import { RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { BacktestRunSummary } from "@/lib/api";
import { formatAbsolutePercent, formatPercent } from "@/lib/format";
import { formatRanAt, formatRunRange } from "@/lib/backtest-utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Header and rows share this template so the columns line up like a table.
const rowGrid =
  "grid min-w-0 flex-1 grid-cols-[6.5rem_3.5rem_2.5rem_5.25rem_3.5rem_minmax(11rem,1fr)_3.25rem_4rem_5rem] items-center gap-x-3";

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
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="text-muted-foreground flex items-center gap-3 px-2 pb-1 text-xs">
          <div className={rowGrid}>
            <span>Ran</span>
            <span>Ticker</span>
            <span>TF</span>
            <span>Mode</span>
            <span>Rules</span>
            <span>Period</span>
            <span className="text-right">Trades</span>
            <span className="text-right">Win rate</span>
            <span className="text-right">Return</span>
          </div>
          {/* Spacer matching the per-row delete button so headers stay aligned. */}
          <span className="w-7 shrink-0" aria-hidden />
        </div>

        {runs.map((run) => (
          <div
            key={run.id}
            className={cn(
              "hover:bg-muted/50 group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
              activeRunId === run.id && "bg-muted/60",
            )}
          >
            <button type="button" className={cn(rowGrid, "text-left")} onClick={() => onOpenRun(run)}>
              <span className="text-muted-foreground text-xs">{formatRanAt(run.created_at)}</span>
              <span className="font-medium">{run.ticker}</span>
              <span className="text-muted-foreground text-xs">{run.timeframe.toUpperCase()}</span>
              <span className="text-muted-foreground text-xs">
                {run.position_mode === "always_in" ? "Long/Short" : "Long only"}
              </span>
              {run.strategy_outdated ? (
                <span
                  className="text-xs text-amber-600 dark:text-amber-400"
                  title="The strategy's rules have been edited since this run; open it to see the rules it used."
                >
                  older
                </span>
              ) : (
                <span className="text-muted-foreground/60 text-xs">current</span>
              )}
              <span className="text-muted-foreground truncate text-xs">{formatRunRange(run)}</span>
              <span className="text-muted-foreground text-right text-xs tabular-nums">
                {run.metrics.trade_count}
              </span>
              <span className="text-muted-foreground text-right text-xs tabular-nums">
                {run.metrics.win_rate_pct == null
                  ? "—"
                  : formatAbsolutePercent(run.metrics.win_rate_pct)}
              </span>
              <span
                className={cn(
                  "text-right font-medium tabular-nums",
                  run.metrics.total_return_pct < 0
                    ? "text-[var(--chart-down)]"
                    : "text-[var(--chart-up)]",
                )}
              >
                {formatPercent(run.metrics.total_return_pct)}
              </span>
            </button>
            {openingRunId === run.id ? (
              <span className="flex size-7 shrink-0 items-center justify-center">
                <RefreshCwIcon className="text-muted-foreground size-3.5 animate-spin" />
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Delete run"
                onClick={() => onDeleteRun(run)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
