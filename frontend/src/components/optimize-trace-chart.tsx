import { useMemo, useState } from "react";

import type { TrialValues } from "@/lib/api-optimization-types";
import type { TracePoint } from "@/lib/optimize-detail-utils";
import { niceTicks } from "@/lib/chart-scale";
import { formatSampledValue, seriesColors } from "@/lib/optimize-chart-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 12, right: 14, bottom: 22, left: 44 };
const height = 240;

const legendItems = [
  { label: "Eligible", color: seriesColors.candidate, mark: "dot" as const },
  { label: "Ineligible", color: "var(--muted-foreground)", mark: "dot" as const },
  { label: "Pruned", color: "var(--muted-foreground)", mark: "hollow" as const },
  { label: "Best so far", color: seriesColors.candidate, mark: "line" as const },
  { label: "Baseline", color: "var(--muted-foreground)", mark: "dashed" as const },
];

export function OptimizeTraceChart({
  points,
  baselineScore,
  valuesByTrial,
  labelById,
}: {
  points: TracePoint[];
  baselineScore: number | null;
  valuesByTrial: Map<number, TrialValues>;
  labelById: Map<string, string>;
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (points.length === 0 || width <= 0) {
      return null;
    }
    const scores = points.map((point) => point.score);
    let min = Math.min(...scores, baselineScore ?? Infinity);
    let max = Math.max(...scores, baselineScore ?? -Infinity);
    const pad = (max - min || Math.abs(max) || 1) * 0.1;
    min -= pad;
    max += pad;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const maxIndex = Math.max(points.at(-1)!.trialIndex, 1);
    const xAt = (trialIndex: number) => margin.left + (trialIndex / maxIndex) * innerWidth;
    const yAt = (score: number) => margin.top + ((max - score) / (max - min)) * innerHeight;

    let bestPath = "";
    for (const point of points) {
      if (point.bestSoFar == null) {
        continue;
      }
      const x = xAt(point.trialIndex).toFixed(2);
      const y = yAt(point.bestSoFar).toFixed(2);
      bestPath += bestPath === "" ? `M${x},${y}` : `H${x}V${y}`;
    }

    const xTicks = niceTicks(0, maxIndex, Math.max(2, Math.min(6, Math.floor(innerWidth / 90))))
      .filter((tick) => Number.isInteger(tick) && tick <= maxIndex);

    return {
      innerWidth,
      xAt,
      yAt,
      bestPath,
      xTicks,
      yTicks: niceTicks(min, max).map((value) => ({ value, y: yAt(value) })),
    };
  }, [baselineScore, points, width]);

  if (points.length === 0) {
    return <p className="text-muted-foreground px-1 text-sm">No scored trials to plot.</p>;
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!plot) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    let nearest = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(plot.xAt(points[index].trialIndex) - x) < Math.abs(plot.xAt(points[nearest].trialIndex) - x)) {
        nearest = index;
      }
    }
    setHovered(nearest);
  }

  const hoveredPoint = hovered != null ? points[hovered] : null;
  const hoveredValues = hoveredPoint ? valuesByTrial.get(hoveredPoint.trialIndex) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label="Score per trial with best-so-far line and baseline reference"
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHovered(null)}
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
                    x={margin.left - 8}
                    y={tick.y + 3.5}
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    textAnchor="end"
                  >
                    {tick.value.toFixed(Math.abs(tick.value) < 10 ? 1 : 0)}
                  </text>
                </g>
              ))}
              {plot.xTicks.map((tick) => (
                <text
                  key={tick}
                  x={plot.xAt(tick)}
                  y={height - 6}
                  fontSize={11}
                  fill="var(--muted-foreground)"
                  textAnchor="middle"
                >
                  {tick}
                </text>
              ))}

              {baselineScore != null ? (
                <line
                  x1={margin.left}
                  x2={margin.left + plot.innerWidth}
                  y1={plot.yAt(baselineScore)}
                  y2={plot.yAt(baselineScore)}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  opacity={0.7}
                />
              ) : null}

              {plot.bestPath ? (
                <path
                  d={plot.bestPath}
                  fill="none"
                  stroke={seriesColors.candidate}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  opacity={0.9}
                />
              ) : null}

              {points.map((point, index) => {
                const isHovered = index === hovered;
                const pruned = point.status === "pruned";
                const color = point.eligible ? seriesColors.candidate : "var(--muted-foreground)";
                return (
                  <circle
                    key={point.trialIndex}
                    cx={plot.xAt(point.trialIndex)}
                    cy={plot.yAt(point.score)}
                    r={isHovered ? 5 : pruned ? 3 : 3.5}
                    fill={pruned ? "none" : color}
                    stroke={pruned ? color : "var(--card)"}
                    strokeWidth={pruned ? 1.5 : 1}
                    opacity={point.eligible || isHovered ? 1 : 0.6}
                  />
                );
              })}

              {hoveredPoint ? (
                <line
                  x1={plot.xAt(hoveredPoint.trialIndex)}
                  x2={plot.xAt(hoveredPoint.trialIndex)}
                  y1={margin.top}
                  y2={height - margin.bottom}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  opacity={0.4}
                  pointerEvents="none"
                />
              ) : null}
            </>
          ) : null}
        </svg>

        {plot && hoveredPoint ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-56 rounded-md border p-2.5 text-xs shadow-md"
            style={{
              top: 8,
              left: Math.min(
                Math.max(plot.xAt(hoveredPoint.trialIndex) - 112, 0),
                Math.max(width - 224, 0),
              ),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Trial {hoveredPoint.trialIndex}</span>
              <span className="font-semibold">{hoveredPoint.score.toFixed(2)}</span>
            </div>
            <div className="text-muted-foreground mt-0.5">
              {hoveredPoint.status === "pruned"
                ? "Pruned by successive halving"
                : hoveredPoint.eligible
                  ? "Eligible"
                  : "Ineligible"}
            </div>
            {hoveredValues && Object.keys(hoveredValues).length > 0 ? (
              <div className="mt-1 flex flex-col gap-0.5 border-t pt-1">
                {Object.entries(hoveredValues).map(([id, value]) => (
                  <div key={id} className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground truncate">{labelById.get(id) ?? id}</span>
                    <span className="tabular-nums">{formatSampledValue(value)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <ChartLegend items={legendItems} />
    </div>
  );
}
