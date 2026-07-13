import { useMemo, useState } from "react";

import { niceTicks } from "@/lib/chart-scale";
import { seriesColors } from "@/lib/optimize-chart-utils";
import type { ParetoChartData, ParetoChartPoint } from "@/lib/optimize-pareto-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 10, right: 14, bottom: 34, left: 44 };
const height = 240;

const legendItems = [
  { label: "Pareto front", color: seriesColors.candidate, mark: "dot" as const },
  { label: "Other scored trials", color: "var(--muted-foreground)", mark: "dot" as const },
  { label: "Baseline", color: seriesColors.baseline, mark: "hollow" as const },
];

export function OptimizeParetoChart({
  data,
  objectiveLabel,
  onSelect,
}: {
  data: ParetoChartData;
  objectiveLabel: string;
  onSelect: (trialIndex: number) => void;
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<ParetoChartPoint | null>(null);

  const plot = useMemo(() => {
    if (width <= 0) {
      return null;
    }
    const xValues = [...data.points.map((p) => p.drawdownPct), data.baseline.drawdownPct];
    const yValues = [...data.points.map((p) => p.objective), data.baseline.objective];
    const xMin = 0;
    const xMax = Math.max(...xValues) || 1;
    const ySpanRaw = Math.max(...yValues) - Math.min(...yValues) || 1;
    const yMin = Math.min(...yValues) - ySpanRaw * 0.08;
    const yMax = Math.max(...yValues) + ySpanRaw * 0.08;
    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const xAt = (value: number) => margin.left + ((value - xMin) / (xMax - xMin || 1)) * innerWidth;
    const yAt = (value: number) => margin.top + ((yMax - value) / (yMax - yMin)) * innerHeight;
    return {
      innerWidth,
      innerHeight,
      xAt,
      yAt,
      xTicks: niceTicks(xMin, xMax, 5).filter((tick) => tick >= xMin && tick <= xMax),
      yTicks: niceTicks(yMin, yMax, 4),
    };
  }, [data, width]);

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label={`Median ${objectiveLabel} versus median drawdown for every scored trial`}
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
          onPointerLeave={() => setHovered(null)}
        >
          {plot ? (
            <>
              {plot.yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  <line
                    x1={margin.left}
                    x2={margin.left + plot.innerWidth}
                    y1={plot.yAt(tick)}
                    y2={plot.yAt(tick)}
                    stroke="var(--border)"
                    strokeWidth={1}
                    opacity={0.55}
                  />
                  <text
                    x={margin.left - 6}
                    y={plot.yAt(tick) + 3.5}
                    fontSize={10}
                    fill="var(--muted-foreground)"
                    textAnchor="end"
                  >
                    {tick.toFixed(Math.abs(tick) < 10 ? 1 : 0)}
                  </text>
                </g>
              ))}
              {plot.xTicks.map((tick) => (
                <text
                  key={`x-${tick}`}
                  x={plot.xAt(tick)}
                  y={height - 18}
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  textAnchor="middle"
                >
                  {tick}%
                </text>
              ))}
              <text
                x={margin.left + plot.innerWidth / 2}
                y={height - 4}
                fontSize={10}
                fill="var(--muted-foreground)"
                textAnchor="middle"
              >
                Median validation drawdown (lower is better)
              </text>

              {data.front.length > 1 ? (
                <polyline
                  points={data.front
                    .map((point) => `${plot.xAt(point.drawdownPct)},${plot.yAt(point.objective)}`)
                    .join(" ")}
                  fill="none"
                  stroke={seriesColors.candidate}
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              ) : null}

              {data.points.map((point) => (
                <g key={point.trialIndex}>
                  <circle
                    cx={plot.xAt(point.drawdownPct)}
                    cy={plot.yAt(point.objective)}
                    r={hovered?.trialIndex === point.trialIndex ? 5 : point.onFront ? 4 : 3}
                    fill={point.onFront ? seriesColors.candidate : "var(--muted-foreground)"}
                    stroke="var(--card)"
                    strokeWidth={1}
                    opacity={point.onFront ? 0.95 : 0.5}
                  />
                  <circle
                    cx={plot.xAt(point.drawdownPct)}
                    cy={plot.yAt(point.objective)}
                    r={9}
                    fill="transparent"
                    className="cursor-pointer"
                    onPointerEnter={() => setHovered(point)}
                    onClick={() => onSelect(point.trialIndex)}
                  />
                </g>
              ))}

              <circle
                cx={plot.xAt(data.baseline.drawdownPct)}
                cy={plot.yAt(data.baseline.objective)}
                r={5}
                fill="none"
                stroke={seriesColors.baseline}
                strokeWidth={2}
              />
            </>
          ) : null}
        </svg>

        {plot && hovered ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-44 rounded-md border p-2 text-xs shadow-md"
            style={{
              top: 4,
              left: Math.min(
                Math.max(plot.xAt(hovered.drawdownPct) - 88, 0),
                Math.max(width - 176, 0),
              ),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {hovered.rank != null ? `#${hovered.rank} · ` : ""}Trial {hovered.trialIndex}
              </span>
              {hovered.onFront ? <span className="text-muted-foreground">front</span> : null}
            </div>
            <div className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2">
              <span>{objectiveLabel}</span>
              <span className="tabular-nums">{hovered.objective.toFixed(2)}</span>
            </div>
            <div className="text-muted-foreground flex items-center justify-between gap-2">
              <span>Drawdown</span>
              <span className="tabular-nums">{hovered.drawdownPct.toFixed(1)}%</span>
            </div>
            <p className="text-muted-foreground/70 mt-1">Click to inspect this trial.</p>
          </div>
        ) : null}
      </div>
      <ChartLegend items={legendItems} />
    </div>
  );
}
