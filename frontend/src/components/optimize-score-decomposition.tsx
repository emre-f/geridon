import { useMemo, useState } from "react";

import { niceTicks, roundedBarPath } from "@/lib/chart-scale";
import {
  penaltyColors,
  penaltyOrder,
  seriesColors,
  type DecompositionRow,
} from "@/lib/optimize-chart-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 4, right: 56, bottom: 22, left: 96 };
const rowBand = 30;
const barHeight = 18;

const penaltyLabels = {
  drawdown: "Drawdown",
  instability: "Instability",
  turnover: "Turnover",
  complexity: "Complexity",
} as const;

const legendItems = [
  { label: "Net score", color: seriesColors.netScore, mark: "rect" as const },
  ...penaltyOrder.map((kind) => ({
    label: `${penaltyLabels[kind]} penalty`,
    color: penaltyColors[kind],
    mark: "rect" as const,
  })),
];

interface Segment {
  kind: "net" | (typeof penaltyOrder)[number];
  from: number;
  to: number;
}

function rowSegments(row: DecompositionRow): Segment[] {
  const segments: Segment[] = [];
  if (row.score > 0) {
    segments.push({ kind: "net", from: 0, to: row.score });
  }
  let cursor = row.score;
  for (const kind of penaltyOrder) {
    const amount = row.penalties[kind];
    if (amount > 0) {
      segments.push({ kind, from: cursor, to: cursor + amount });
      cursor += amount;
    }
  }
  return segments;
}

export function OptimizeScoreDecomposition({ rows }: { rows: DecompositionRow[] }) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const height = margin.top + rows.length * rowBand + margin.bottom;

  const plot = useMemo(() => {
    if (rows.length === 0 || width <= 0) {
      return null;
    }
    let min = 0;
    let max = 0;
    for (const row of rows) {
      min = Math.min(min, row.score, row.medianObjective);
      max = Math.max(max, row.score, row.medianObjective);
    }
    const pad = (max - min || 1) * 0.06;
    min -= pad;
    max += pad;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const xAt = (value: number) => margin.left + ((value - min) / (max - min)) * innerWidth;
    return { innerWidth, xAt, xTicks: niceTicks(min, max, 5) };
  }, [rows, width]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label="Median objective with penalties subtracted, per candidate"
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
          onPointerLeave={() => setHovered(null)}
        >
          {plot ? (
            <>
              {plot.xTicks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={plot.xAt(tick)}
                    x2={plot.xAt(tick)}
                    y1={margin.top}
                    y2={height - margin.bottom}
                    stroke={tick === 0 ? "var(--muted-foreground)" : "var(--border)"}
                    strokeWidth={1}
                    opacity={tick === 0 ? 0.6 : 0.55}
                  />
                  <text
                    x={plot.xAt(tick)}
                    y={height - 6}
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    textAnchor="middle"
                  >
                    {tick.toFixed(Math.abs(tick) < 10 ? 1 : 0)}
                  </text>
                </g>
              ))}

              {rows.map((row, index) => {
                const segments = rowSegments(row);
                const y = margin.top + index * rowBand + (rowBand - barHeight) / 2;
                const rowEnd = Math.max(row.medianObjective, row.score, 0);
                return (
                  <g key={row.key} opacity={hovered == null || hovered === index ? 1 : 0.45}>
                    <text
                      x={margin.left - 8}
                      y={y + barHeight / 2 + 3.5}
                      fontSize={11}
                      fill="var(--muted-foreground)"
                      textAnchor="end"
                    >
                      {row.label}
                    </text>
                    {segments.map((segment, segmentIndex) => {
                      const rawLeft = plot.xAt(Math.min(segment.from, segment.to));
                      const rawRight = plot.xAt(Math.max(segment.from, segment.to));
                      const left = rawLeft + (segmentIndex > 0 ? 1 : 0);
                      const right = rawRight - (segmentIndex < segments.length - 1 ? 1 : 0);
                      if (right - left <= 0) {
                        return null;
                      }
                      const isLast = segmentIndex === segments.length - 1;
                      const isFirst = segmentIndex === 0;
                      const roundLeft = isFirst && Math.min(segment.from, segment.to) < 0;
                      return (
                        <path
                          key={segment.kind}
                          d={roundedBarPath(left, y, right - left, barHeight, 4, {
                            topRight: isLast,
                            bottomRight: isLast,
                            topLeft: roundLeft,
                            bottomLeft: roundLeft,
                          })}
                          fill={
                            segment.kind === "net" ? seriesColors.netScore : penaltyColors[segment.kind]
                          }
                        />
                      );
                    })}
                    <line
                      x1={plot.xAt(row.score)}
                      x2={plot.xAt(row.score)}
                      y1={y - 2}
                      y2={y + barHeight + 2}
                      stroke="var(--foreground)"
                      strokeWidth={1.5}
                      opacity={0.8}
                    />
                    <text
                      x={plot.xAt(rowEnd) + 6}
                      y={y + barHeight / 2 + 3.5}
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--foreground)"
                    >
                      {row.score.toFixed(2)}
                    </text>
                    <rect
                      x={0}
                      y={margin.top + index * rowBand}
                      width={width}
                      height={rowBand}
                      fill="transparent"
                      onPointerEnter={() => setHovered(index)}
                    />
                  </g>
                );
              })}
            </>
          ) : null}
        </svg>

        {plot && hovered != null ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-52 rounded-md border p-2.5 text-xs shadow-md"
            style={{
              top: Math.min(margin.top + hovered * rowBand + rowBand, height - 150),
              left: Math.max(width - 224, 0),
            }}
          >
            <div className="font-medium">{rows[hovered].label}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Median objective</span>
              <span className="tabular-nums">{rows[hovered].medianObjective.toFixed(2)}</span>
            </div>
            {penaltyOrder.map((kind) => (
              <div key={kind} className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-3 shrink-0"
                    style={{ backgroundColor: penaltyColors[kind] }}
                    aria-hidden="true"
                  />
                  {penaltyLabels[kind]}
                </span>
                <span className="tabular-nums">−{rows[hovered].penalties[kind].toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1 font-medium">
              <span>Net score</span>
              <span className="tabular-nums">{rows[hovered].score.toFixed(2)}</span>
            </div>
          </div>
        ) : null}
      </div>
      <ChartLegend items={legendItems} />
    </div>
  );
}
