import type { BacktestMetrics } from "@/lib/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Stat {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}

interface StatGroup {
  heading: string;
  stats: Stat[];
}

const upDownTone = (value: number) =>
  value < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]";

function buildGroups(metrics: BacktestMetrics): StatGroup[] {
  return [
    {
      heading: "Returns",
      stats: [
        {
          label: "Total return",
          value: formatPercent(metrics.total_return_pct),
          tone: upDownTone(metrics.total_return_pct),
        },
        {
          label: "Annualized",
          value:
            metrics.annualized_return_pct == null
              ? "—"
              : formatPercent(metrics.annualized_return_pct),
          tone: metrics.annualized_return_pct == null ? undefined : upDownTone(metrics.annualized_return_pct),
        },
        {
          label: "Final equity",
          value: formatCurrency(metrics.final_equity),
          detail: `from ${formatCurrency(metrics.initial_capital)}`,
        },
      ],
    },
    {
      heading: "Risk",
      stats: [
        {
          label: "Max drawdown",
          value: metrics.max_drawdown_pct == null ? "—" : formatPercent(metrics.max_drawdown_pct),
          tone: (metrics.max_drawdown_pct ?? 0) < 0 ? "text-[var(--chart-down)]" : undefined,
        },
        {
          label: "Sharpe",
          value: metrics.sharpe_ratio == null ? "—" : metrics.sharpe_ratio.toFixed(2),
        },
        {
          label: "Profit factor",
          value: metrics.profit_factor == null ? "—" : metrics.profit_factor.toFixed(2),
        },
      ],
    },
    {
      heading: "Activity",
      stats: [
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
        {
          label: "Avg trade",
          value: metrics.avg_trade_pnl == null ? "—" : formatCurrency(metrics.avg_trade_pnl),
          tone: metrics.avg_trade_pnl == null ? undefined : upDownTone(metrics.avg_trade_pnl),
        },
      ],
    },
  ];
}

export function BacktestSummary({ metrics }: { metrics: BacktestMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
      {buildGroups(metrics).map((group, index) => (
        <div
          key={group.heading}
          className={cn(
            "flex flex-col gap-2",
            index > 0 && "sm:border-border sm:border-l sm:pl-8",
          )}
        >
          <span className="text-muted-foreground/60 text-[10px] font-semibold uppercase tracking-wider">
            {group.heading}
          </span>
          <dl className="flex flex-col gap-1.5">
            {group.stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground text-xs">{stat.label}</dt>
                <dd className="flex items-baseline gap-1.5 text-right">
                  <span className={cn("text-sm font-semibold tabular-nums", stat.tone)}>
                    {stat.value}
                  </span>
                  {stat.detail ? (
                    <span className="text-muted-foreground/70 text-[11px]">{stat.detail}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
