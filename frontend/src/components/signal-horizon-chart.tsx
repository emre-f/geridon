import { useMemo, useState } from "react";

import type { CostLine } from "@/lib/api-client-signals-registry";
import { niceTicks, roundedBarPath } from "@/lib/chart-scale";
import { formatReturnValue, formatScaledTick, returnScaleFor } from "@/lib/signal-lab-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 16, right: 14, bottom: 24, left: 48 };
const height = 220;
const maxBarWidth = 24;

const grossColor = "var(--viz-baseline)";
const netColor = "var(--viz-candidate)";

const legendItems = [
  { label: "Gross abnormal", color: grossColor, mark: "rect" as const },
  { label: "Net of costs", color: netColor, mark: "rect" as const },
];

export function SignalHorizonChart({ costLine }: { costLine: CostLine }) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const rows = costLine.rows;

  const plot = useMemo(() => {
    if (rows.length === 0 || width <= 0) {
      return null;
    }
    const rawValues = [0];
    for (const row of rows) {
      for (const value of [row.abnormal, row.net_abnormal]) {
        if (value != null) {
          rawValues.push(value);
        }
      }
    }
    const { unit, scale } = returnScaleFor(Math.max(...rawValues.map(Math.abs)));
    let min = Math.min(...rawValues) * scale;
    let max = Math.max(...rawValues) * scale;
    const pad = (max - min || 1) * 0.08;
    min = min < 0 ? min - pad : min;
    max = max > 0 ? max + pad : max;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const band = innerWidth / rows.length;
    const barWidth = Math.min(maxBarWidth, Math.max(4, band / 2 - 2));
    const clusterWidth = barWidth * 2 + 2;
    const yAt = (scaled: number) => margin.top + ((max - scaled) / (max - min)) * innerHeight;
    const barX = (rowIndex: number, seriesIndex: number) =>
      margin.left + rowIndex * band + (band - clusterWidth) / 2 + seriesIndex * (barWidth + 2);

    return {
      unit,
      scale,
      innerWidth,
      innerHeight,
      band,
      barWidth,
      yAt,
      barX,
      zeroY: yAt(0),
      yTicks: niceTicks(min, max).map((value) => ({ value, y: yAt(value) })),
    };
  }, [rows, width]);

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No horizon data to plot.</p>;
  }

  const hoveredRow = hovered != null ? rows[hovered] : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label="Abnormal return per event at each holding horizon, gross and net of costs"
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
          onPointerLeave={() => setHovered(null)}
        >
          {plot ? (
            <>
              {costLine.headline_horizon != null
                ? rows.map((row, rowIndex) =>
                    row.horizon === costLine.headline_horizon ? (
                      <rect
                        key="headline"
                        x={margin.left + rowIndex * plot.band}
                        y={margin.top}
                        width={plot.band}
                        height={plot.innerHeight}
                        fill="var(--muted)"
                        opacity={0.6}
                      />
                    ) : null,
                  )
                : null}
              {plot.yTicks.map((tick) => (
                <g key={tick.value}>
                  <line
                    x1={margin.left}
                    x2={margin.left + plot.innerWidth}
                    y1={tick.y}
                    y2={tick.y}
                    stroke={tick.value === 0 ? "var(--muted-foreground)" : "var(--border)"}
                    strokeWidth={1}
                    opacity={tick.value === 0 ? 0.6 : 0.55}
                  />
                  <text x={margin.left - 8} y={tick.y + 3.5} fontSize={11} fill="var(--muted-foreground)" textAnchor="end">
                    {formatScaledTick(tick.value)}
                  </text>
                </g>
              ))}
              <text x={margin.left - 8} y={margin.top - 5} fontSize={10} fill="var(--muted-foreground)" textAnchor="end">
                {plot.unit}
              </text>

              {rows.map((row, rowIndex) => (
                <g key={row.horizon} opacity={hovered == null || hovered === rowIndex ? 1 : 0.5}>
                  {[row.abnormal, row.net_abnormal].map((value, seriesIndex) => {
                    if (value == null) {
                      return null;
                    }
                    const scaled = value * plot.scale;
                    const top = Math.min(plot.yAt(scaled), plot.zeroY);
                    const barHeight = Math.max(Math.abs(plot.yAt(scaled) - plot.zeroY), 1);
                    const positive = value >= 0;
                    return (
                      <path
                        key={seriesIndex}
                        d={roundedBarPath(
                          plot.barX(rowIndex, seriesIndex),
                          top,
                          plot.barWidth,
                          barHeight,
                          4,
                          positive
                            ? { topLeft: true, topRight: true }
                            : { bottomLeft: true, bottomRight: true },
                        )}
                        fill={seriesIndex === 0 ? grossColor : netColor}
                      />
                    );
                  })}
                  <text
                    x={margin.left + rowIndex * plot.band + plot.band / 2}
                    y={height - 6}
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    textAnchor="middle"
                  >
                    {row.horizon}
                  </text>
                  <rect
                    x={margin.left + rowIndex * plot.band}
                    y={margin.top}
                    width={plot.band}
                    height={plot.innerHeight}
                    fill="transparent"
                    onPointerEnter={() => setHovered(rowIndex)}
                  />
                </g>
              ))}
            </>
          ) : null}
        </svg>

        {plot && hoveredRow && hovered != null ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-52 rounded-md border p-2.5 text-xs shadow-md"
            style={{
              top: 8,
              left: Math.min(
                Math.max(margin.left + hovered * plot.band + plot.band / 2 - 104, 0),
                Math.max(width - 216, 0),
              ),
            }}
          >
            <div className="font-medium">{hoveredRow.horizon} bars held</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Gross abnormal</span>
              <span className="tabular-nums font-medium">{formatReturnValue(hoveredRow.abnormal)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Net of costs</span>
              <span className="tabular-nums font-medium">{formatReturnValue(hoveredRow.net_abnormal)}</span>
            </div>
            {hoveredRow.horizon === costLine.headline_horizon ? (
              <div className="text-muted-foreground mt-1">Headline horizon (natural holding period)</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ChartLegend items={legendItems} />
        <span className="text-muted-foreground px-1 text-xs">
          x: trading days held · shaded column: headline horizon · round trip cost{" "}
          {formatReturnValue(-costLine.round_trip_cost).replace("+", "")}
        </span>
      </div>
    </div>
  );
}
