import type { BacktestEquityPoint } from "@/lib/api";
import type { buildEquityChartPlot } from "@/lib/equity-chart-plot";
import { formatCompactCurrency, formatDate, formatPercent } from "@/lib/format";

type EquityChartPlot = NonNullable<ReturnType<typeof buildEquityChartPlot>>;

export function EquityChartTooltip({
  plot,
  hoverPoint,
  hoverIndex,
  width,
  timeframe,
  initialCapital,
  tone,
}: {
  plot: EquityChartPlot;
  hoverPoint: BacktestEquityPoint;
  hoverIndex: number;
  width: number;
  timeframe: string;
  initialCapital: number;
  tone: string;
}) {
  return (
    <div
      className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-56 rounded-md border p-2.5 text-xs shadow-md"
      style={{
        top: 8,
        left: Math.min(Math.max(plot.xAt(hoverIndex) - 112, 0), Math.max(width - 224, 0)),
      }}
    >
      <div className="text-muted-foreground">{formatDate(hoverPoint.timestamp_ms, timeframe)}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tone }}
            aria-hidden="true"
          />
          Strategy
        </span>
        <span className="tabular-nums">
          {formatCompactCurrency(hoverPoint.equity)}{" "}
          <span style={{ color: hoverPoint.equity < initialCapital ? "var(--chart-down)" : "var(--chart-up)" }}>
            {formatPercent((hoverPoint.equity / initialCapital - 1) * 100)}
          </span>
        </span>
      </div>
      {plot.overlayPaths.map(({ overlay, valueByIndex }) => {
        const value = valueByIndex.get(hoverIndex);
        if (value == null) {
          return null;
        }
        return (
          <div key={overlay.id} className="mt-1 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: overlay.style.color }}
                aria-hidden="true"
              />
              <span className="truncate">{overlay.label}</span>
            </span>
            <span className="tabular-nums whitespace-nowrap">
              {formatCompactCurrency(value)}{" "}
              <span className="text-muted-foreground">
                {formatPercent((value / initialCapital - 1) * 100)}
              </span>
            </span>
          </div>
        );
      })}
      <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2">
        <span>Cash {formatCompactCurrency(hoverPoint.cash)}</span>
        <span>
          {hoverPoint.position_value < 0
            ? `Short ${formatCompactCurrency(-hoverPoint.position_value)}`
            : `Invested ${formatCompactCurrency(hoverPoint.position_value)}`}
        </span>
      </div>
    </div>
  );
}
