import { formatCurrency, formatDate } from "@/lib/format";
import { margin, type ChartPoint } from "@/components/stock-chart/chart-types";
import { priceTicks, xTicks } from "@/components/stock-chart/chart-geometry";

interface ChartGridProps {
  width: number;
  height: number;
  timeframe: string;
  priceMin: number;
  priceMax: number;
  plotWidth: number;
  plotHeight: number;
  volumeTop: number;
  points: ChartPoint[];
}

/** Price gridlines with labels, the volume separator, and the time axis. */
export function ChartGrid({
  width,
  height,
  timeframe,
  priceMin,
  priceMax,
  plotWidth,
  plotHeight,
  volumeTop,
  points,
}: ChartGridProps) {
  return (
    <>
      {priceTicks(priceMin, priceMax).map((tick) => {
        const y = margin.top + ((priceMax - tick) / (priceMax - priceMin || 1)) * plotHeight;

        return (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <text
              x={width - 8}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatCurrency(tick)}
            </text>
          </g>
        );
      })}

      <line
        x1={margin.left}
        x2={margin.left + plotWidth}
        y1={volumeTop}
        y2={volumeTop}
        stroke="var(--border)"
      />

      {xTicks(points).map((point, tickIndex, ticks) => {
        const isFirstTick = tickIndex === 0;
        const isLastTick = tickIndex === ticks.length - 1;

        return (
          <text
            key={point.candle.timestamp_ms}
            x={isFirstTick ? margin.left : isLastTick ? margin.left + plotWidth : point.x}
            y={height - 10}
            textAnchor={isFirstTick ? "start" : isLastTick ? "end" : "middle"}
            className="fill-muted-foreground text-[11px]"
          >
            {formatDate(point.candle.timestamp_ms, timeframe)}
          </text>
        );
      })}
    </>
  );
}
