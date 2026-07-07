import type { BacktestMetrics } from "@/lib/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BacktestMetricsGrid({ metrics }: { metrics: BacktestMetrics }) {
  const returnTone =
    metrics.total_return_pct < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="border-border rounded-md border p-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase">Total return</p>
        <p className={cn("mt-1 text-2xl font-semibold leading-none", returnTone)}>
          {formatPercent(metrics.total_return_pct)}
        </p>
      </div>
      <div className="border-border rounded-md border p-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase">Final equity</p>
        <p className="mt-1 text-2xl font-semibold leading-none">
          {formatCurrency(metrics.final_equity)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          from {formatCurrency(metrics.initial_capital)}
        </p>
      </div>
      <div className="border-border rounded-md border p-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase">Trades</p>
        <p className="mt-1 text-2xl font-semibold leading-none">{metrics.trade_count}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {metrics.buy_count} buys · {metrics.sell_count} sells
        </p>
      </div>
      <div className="border-border rounded-md border p-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase">Win rate</p>
        <p className="mt-1 text-2xl font-semibold leading-none">
          {metrics.win_rate_pct == null ? "—" : `${metrics.win_rate_pct.toFixed(0)}%`}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">of closing trades</p>
      </div>
    </div>
  );
}
