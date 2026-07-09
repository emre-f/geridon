import type { BacktestMetrics, BacktestRunRecord } from "@/lib/api";
import { seriesMetrics } from "@/lib/backtest-utils";
import { formatCompactCurrency, formatPercent } from "@/lib/format";
import type { EquityOverlay } from "@/components/equity-chart";
import { cn } from "@/lib/utils";

const upDownTone = (value: number) =>
  value < 0 ? "text-[var(--chart-down)]" : "text-[var(--chart-up)]";

interface Row {
  id: string;
  label: string;
  color: string;
  totalReturnPct: number;
  maxDrawdownPct: number | null;
  finalValue: number;
}

export function BenchmarkMetrics({
  activeRun,
  metrics,
  overlays,
}: {
  activeRun: BacktestRunRecord;
  metrics: BacktestMetrics;
  overlays: EquityOverlay[];
}) {
  const rows: Row[] = [
    {
      id: "strategy",
      label: "Strategy",
      color:
        metrics.final_equity < metrics.initial_capital
          ? "var(--chart-down)"
          : "var(--chart-up)",
      totalReturnPct: metrics.total_return_pct,
      maxDrawdownPct: metrics.max_drawdown_pct,
      finalValue: metrics.final_equity,
    },
  ];

  for (const overlay of overlays) {
    const stats = seriesMetrics(
      overlay.points.map((point) => point.value),
      activeRun.initial_capital,
    );
    if (!stats) {
      continue;
    }
    rows.push({
      id: overlay.id,
      label: overlay.label,
      color: overlay.style.color,
      totalReturnPct: stats.totalReturnPct,
      maxDrawdownPct: stats.maxDrawdownPct,
      finalValue: stats.finalValue,
    });
  }

  if (rows.length <= 1) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground/60 text-[10px] font-semibold uppercase tracking-wider">
            <th className="py-1 text-left font-semibold">Line</th>
            <th className="py-1 text-right font-semibold">Return</th>
            <th className="py-1 text-right font-semibold">Max DD</th>
            <th className="py-1 text-right font-semibold">Final</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-border/50 border-t">
              <td className="py-1.5">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{row.label}</span>
                </span>
              </td>
              <td
                className={cn(
                  "py-1.5 text-right font-semibold tabular-nums",
                  upDownTone(row.totalReturnPct),
                )}
              >
                {formatPercent(row.totalReturnPct)}
              </td>
              <td className="text-muted-foreground py-1.5 text-right tabular-nums">
                {row.maxDrawdownPct == null ? "—" : formatPercent(row.maxDrawdownPct)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatCompactCurrency(row.finalValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
