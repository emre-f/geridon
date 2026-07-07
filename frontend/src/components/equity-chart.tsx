import { useMemo, useState } from "react";

import type { BacktestEquityPoint, BacktestTrade, IndicatorLineStyle } from "@/lib/api";
import { formatCompactCurrency, formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { strokeDashArray } from "@/lib/indicator-style";
import { useElementSize } from "@/hooks/use-element-size";
import { cn } from "@/lib/utils";

/** A buy-and-hold comparison line, already normalized to the run's starting capital. */
export interface EquityOverlay {
  id: string;
  label: string;
  style: IndicatorLineStyle;
  points: Array<{ timestamp_ms: number; value: number }>;
}

interface EquityChartProps {
  points: BacktestEquityPoint[];
  trades: BacktestTrade[];
  initialCapital: number;
  timeframe: string;
  overlays?: EquityOverlay[];
  height?: number;
  className?: string;
}

const margin = { top: 12, right: 64, bottom: 26, left: 10 };
const maxTradeMarkers = 60;

function niceTicks(min: number, max: number, count = 4) {
  if (!(max > min)) {
    return [min];
  }
  const step = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= step) ?? step;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / niceStep) * niceStep; tick <= max + niceStep / 1e6; tick += niceStep) {
    ticks.push(tick);
  }
  return ticks;
}

/**
 * Equity curve for a backtest run: the strategy line tinted by outcome, a
 * dashed baseline at the starting capital, optional buy-and-hold comparison
 * overlays, and a crosshair tooltip covering every visible series.
 */
export function EquityChart({
  points,
  trades,
  initialCapital,
  timeframe,
  overlays = [],
  height = 300,
  className,
}: EquityChartProps) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (points.length === 0 || width <= 0) {
      return null;
    }

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const indexByTimestamp = new Map(points.map((point, index) => [point.timestamp_ms, index]));

    // Comparison points that don't share a bar with the equity curve (e.g. a
    // different trading calendar) are dropped rather than interpolated.
    const overlayPlots = overlays.map((overlay) => ({
      overlay,
      matched: overlay.points.flatMap((point) => {
        const index = indexByTimestamp.get(point.timestamp_ms);
        return index == null ? [] : [{ index, value: point.value }];
      }),
    }));

    let min = Math.min(...points.map((point) => point.equity), initialCapital);
    let max = Math.max(...points.map((point) => point.equity), initialCapital);
    for (const { matched } of overlayPlots) {
      for (const point of matched) {
        min = Math.min(min, point.value);
        max = Math.max(max, point.value);
      }
    }
    const pad = (max - min || max || 1) * 0.08;
    const domainMin = min - pad;
    const domainMax = max + pad;

    const xAt = (index: number) =>
      margin.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const yAt = (value: number) =>
      margin.top + ((domainMax - value) / (domainMax - domainMin)) * innerHeight;

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(point.equity).toFixed(2)}`)
      .join("");
    const baselineY = yAt(initialCapital);
    const areaPath = `${linePath}L${xAt(points.length - 1).toFixed(2)},${baselineY.toFixed(2)}L${xAt(0).toFixed(2)},${baselineY.toFixed(2)}Z`;

    const overlayPaths = overlayPlots
      .filter(({ matched }) => matched.length > 1)
      .map(({ overlay, matched }) => ({
        overlay,
        path: matched
          .map((point, order) => `${order === 0 ? "M" : "L"}${xAt(point.index).toFixed(2)},${yAt(point.value).toFixed(2)}`)
          .join(""),
        valueByIndex: new Map(matched.map((point) => [point.index, point.value])),
      }));

    const markers =
      trades.length > maxTradeMarkers
        ? []
        : trades.flatMap((trade) => {
            const index = indexByTimestamp.get(trade.timestamp_ms);
            if (index == null) {
              return [];
            }
            return [{ trade, x: xAt(index), y: yAt(points[index].equity) }];
          });

    const tickCountX = Math.max(2, Math.min(6, Math.floor(innerWidth / 130)));
    const xTicks = Array.from({ length: tickCountX }, (_, tick) => {
      const index = Math.round((tick / (tickCountX - 1)) * (points.length - 1));
      return { x: xAt(index), label: formatDate(points[index].timestamp_ms, timeframe) };
    });

    return {
      innerWidth,
      xAt,
      yAt,
      linePath,
      areaPath,
      baselineY,
      overlayPaths,
      markers,
      xTicks,
      yTicks: niceTicks(domainMin, domainMax).map((value) => ({ y: yAt(value), value })),
    };
  }, [height, initialCapital, overlays, points, timeframe, trades, width]);

  if (points.length === 0) {
    return null;
  }

  const finalEquity = points.at(-1)!.equity;
  const tone = finalEquity < initialCapital ? "var(--chart-down)" : "var(--chart-up)";
  const toneMuted =
    finalEquity < initialCapital ? "var(--chart-down-muted)" : "var(--chart-up-muted)";
  const hoverPoint = hoverIndex != null ? points[hoverIndex] : null;

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!plot) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const ratio = (x - margin.left) / plot.innerWidth;
    const index = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), points.length - 1));
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <svg
        role="img"
        aria-label="Equity curve"
        width="100%"
        height={height}
        viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {plot ? (
          <>
            {plot.yTicks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={margin.left}
                  x2={margin.left + plot.innerWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.55}
                />
                <text
                  x={margin.left + plot.innerWidth + 8}
                  y={tick.y + 3.5}
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {formatCompactCurrency(tick.value)}
                </text>
              </g>
            ))}
            <line
              x1={margin.left}
              x2={margin.left + plot.innerWidth}
              y1={plot.baselineY}
              y2={plot.baselineY}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={1}
              opacity={0.7}
            />
            <path d={plot.areaPath} fill={toneMuted} opacity={0.25} />

            {plot.overlayPaths.map(({ overlay, path }) => (
              <path
                key={overlay.id}
                d={path}
                fill="none"
                stroke={overlay.style.color}
                strokeWidth={overlay.style.width}
                strokeOpacity={overlay.style.opacity}
                strokeDasharray={strokeDashArray(overlay.style.stroke, overlay.style.width)}
                strokeLinejoin="round"
              />
            ))}

            <path d={plot.linePath} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />

            {plot.markers.map(({ trade, x, y }, index) => (
              <path
                key={`${trade.timestamp_ms}-${index}`}
                d={
                  trade.side === "buy"
                    ? `M${x},${y - 10}l4.5,7h-9Z`
                    : `M${x},${y + 10}l4.5,-7h-9Z`
                }
                fill={trade.side === "buy" ? "var(--chart-up)" : "var(--chart-down)"}
                stroke="var(--background)"
                strokeWidth={1}
              >
                <title>
                  {`${trade.side === "buy" ? "Buy" : "Sell"} ${formatCurrency(trade.value)} @ ${formatCurrency(trade.price)}`}
                </title>
              </path>
            ))}

            {plot.xTicks.map((tick, index) => (
              <text
                key={index}
                x={tick.x}
                y={height - 8}
                fontSize={11}
                fill="var(--muted-foreground)"
                textAnchor={index === 0 ? "start" : index === plot.xTicks.length - 1 ? "end" : "middle"}
              >
                {tick.label}
              </text>
            ))}

            {hoverPoint && hoverIndex != null ? (
              <g pointerEvents="none">
                <line
                  x1={plot.xAt(hoverIndex)}
                  x2={plot.xAt(hoverIndex)}
                  y1={margin.top}
                  y2={height - margin.bottom}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  opacity={0.5}
                />
                <circle
                  cx={plot.xAt(hoverIndex)}
                  cy={plot.yAt(hoverPoint.equity)}
                  r={4}
                  fill={tone}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              </g>
            ) : null}
          </>
        ) : null}
      </svg>

      {plot && hoverPoint && hoverIndex != null ? (
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
      ) : null}
    </div>
  );
}
