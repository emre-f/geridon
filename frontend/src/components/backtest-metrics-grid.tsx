import { Fragment } from "react";

import type { BacktestMetrics } from "@/lib/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BacktestMetricsGrid({ metrics }: { metrics: BacktestMetrics }) {
  const returnTone =
    metrics.total_return_pct < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]";

  const stats: { label: string; value: string; detail?: string; tone?: string }[] = [
    {
      label: "Total return",
      value: formatPercent(metrics.total_return_pct),
      tone: returnTone,
    },
    {
      label: "Final equity",
      value: formatCurrency(metrics.final_equity),
      detail: `from ${formatCurrency(metrics.initial_capital)}`,
    },
    {
      label: "Trades",
      value: String(metrics.trade_count),
      detail: `${metrics.buy_count} buys · ${metrics.sell_count} sells`,
    },
    {
      label: "Win rate",
      value: metrics.win_rate_pct == null ? "—" : `${metrics.win_rate_pct.toFixed(0)}%`,
      detail: "of closing trades",
    },
  ];

  return (
    <div className="border-border flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 border-y py-2.5 text-sm">
      {stats.map((stat, index) => (
        <Fragment key={stat.label}>
          {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-medium uppercase">{stat.label}</span>
            <span className={cn("font-semibold", stat.tone)}>{stat.value}</span>
            {stat.detail ? (
              <span className="text-muted-foreground">{stat.detail}</span>
            ) : null}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
