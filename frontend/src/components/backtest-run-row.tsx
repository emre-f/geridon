import { RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { BacktestRunSummary } from "@/lib/api";
import { formatAbsolutePercent, formatPercent } from "@/lib/format";
import { formatRanAt, formatRunRange } from "@/lib/backtest-utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Header and rows share this template so the columns line up like a table.
export const runsRowGrid =
  "grid min-w-0 flex-1 grid-cols-[6.5rem_3.5rem_2.5rem_5.25rem_3.5rem_minmax(10rem,1fr)_3rem_4rem_5rem_4.75rem_3.75rem] items-center gap-x-3";

export function BacktestRunRow({
  run,
  active,
  opening,
  onOpenRun,
  onDeleteRun,
}: {
  run: BacktestRunSummary;
  active: boolean;
  opening: boolean;
  onOpenRun: (run: BacktestRunSummary) => void;
  onDeleteRun: (run: BacktestRunSummary) => void;
}) {
  const { metrics } = run;

  return (
    <div
      className={cn(
        "hover:bg-muted/50 group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
        active && "bg-muted/60",
      )}
    >
      <button type="button" className={cn(runsRowGrid, "text-left")} onClick={() => onOpenRun(run)}>
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
          {metrics.trade_count}
        </span>
        <span className="text-muted-foreground text-right text-xs tabular-nums">
          {metrics.win_rate_pct == null ? "—" : formatAbsolutePercent(metrics.win_rate_pct)}
        </span>
        <span
          className={cn(
            "text-right font-medium tabular-nums",
            metrics.total_return_pct < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]",
          )}
        >
          {formatPercent(metrics.total_return_pct)}
        </span>
        <span
          className={cn(
            "text-right text-xs tabular-nums",
            (metrics.max_drawdown_pct ?? 0) < 0 ? "text-[var(--chart-down)]" : "text-muted-foreground",
          )}
        >
          {metrics.max_drawdown_pct == null ? "—" : formatPercent(metrics.max_drawdown_pct)}
        </span>
        <span className="text-muted-foreground text-right text-xs tabular-nums">
          {metrics.sharpe_ratio == null ? "—" : metrics.sharpe_ratio.toFixed(2)}
        </span>
      </button>
      {opening ? (
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
  );
}
