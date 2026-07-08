import type { BacktestRunRecord } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BacktestTradesTable({ activeRun }: { activeRun: BacktestRunRecord }) {
  if (activeRun.trades.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No trades executed — the entry condition never triggered in this range.
      </p>
    );
  }

  return (
    <div className="border-border max-h-64 overflow-auto rounded-md border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/60 sticky top-0 backdrop-blur">
          <tr className="text-muted-foreground text-left text-xs">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Side</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Shares</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
            <th className="px-3 py-2 text-right font-medium">Realized P&L</th>
            <th className="px-3 py-2 text-right font-medium">Equity after</th>
          </tr>
        </thead>
        <tbody>
          {activeRun.trades.map((trade) => (
            <tr
              key={`${trade.timestamp_ms}-${trade.side}-${trade.equity_after}`}
              className="border-border border-t"
            >
              <td className="px-3 py-1.5 whitespace-nowrap">
                {formatDate(trade.timestamp_ms, activeRun.timeframe)}
              </td>
              <td className="px-3 py-1.5">
                <span
                  className={
                    trade.side === "buy" ? "text-[var(--chart-up)]" : "text-[var(--chart-down)]"
                  }
                >
                  {trade.side === "buy" ? "Buy" : "Sell"}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right">{formatCurrency(trade.price)}</td>
              <td className="px-3 py-1.5 text-right">{trade.shares.toFixed(4)}</td>
              <td className="px-3 py-1.5 text-right">{formatCurrency(trade.value)}</td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right",
                  trade.realized_pnl == null
                    ? "text-muted-foreground"
                    : trade.realized_pnl < 0
                      ? "text-[var(--chart-down)]"
                      : "text-[var(--chart-up)]",
                )}
              >
                {trade.realized_pnl == null ? "—" : formatCurrency(trade.realized_pnl)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {formatCurrency(trade.equity_after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
