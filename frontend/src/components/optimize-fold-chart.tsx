import { useMemo, useState } from "react";

import { niceTicks, roundedBarPath } from "@/lib/chart-scale";
import { seriesColors, type FoldGroup } from "@/lib/optimize-chart-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 12, right: 14, bottom: 24, left: 44 };
const height = 220;
const maxBarWidth = 24;

interface FoldSeries {
  key: "baseline" | "buyHold" | "candidate";
  label: string;
  color: string;
}

export function OptimizeFoldChart({
  groups,
  candidateLabel,
  objectiveLabel,
}: {
  groups: FoldGroup[];
  candidateLabel: string | null;
  objectiveLabel: string;
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const series: FoldSeries[] = useMemo(
    () => [
      { key: "baseline", label: "Baseline", color: seriesColors.baseline },
      { key: "buyHold", label: "Buy & hold", color: seriesColors.buyHold },
      ...(candidateLabel != null
        ? [{ key: "candidate" as const, label: candidateLabel, color: seriesColors.candidate }]
        : []),
    ],
    [candidateLabel],
  );

  const plot = useMemo(() => {
    if (groups.length === 0 || width <= 0) {
      return null;
    }
    let min = 0;
    let max = 0;
    for (const group of groups) {
      for (const { key } of series) {
        const value = group[key];
        if (value != null) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }
    const pad = (max - min || 1) * 0.08;
    min = min < 0 ? min - pad : min;
    max = max > 0 ? max + pad : max;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const band = innerWidth / groups.length;
    const barWidth = Math.min(maxBarWidth, Math.max(4, band / series.length - 2));
    const clusterWidth = barWidth * series.length + 2 * (series.length - 1);
    const yAt = (value: number) => margin.top + ((max - value) / (max - min)) * innerHeight;
    const barX = (groupIndex: number, seriesIndex: number) =>
      margin.left + groupIndex * band + (band - clusterWidth) / 2 + seriesIndex * (barWidth + 2);

    return {
      innerWidth,
      band,
      barWidth,
      yAt,
      barX,
      zeroY: yAt(0),
      yTicks: niceTicks(min, max).map((value) => ({ value, y: yAt(value) })),
    };
  }, [groups, series, width]);

  if (groups.length === 0) {
    return null;
  }

  const hoveredGroup = hovered != null ? groups[hovered] : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label={`${objectiveLabel} per validation fold`}
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
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
                    stroke={tick.value === 0 ? "var(--muted-foreground)" : "var(--border)"}
                    strokeWidth={1}
                    opacity={tick.value === 0 ? 0.6 : 0.55}
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

              {groups.map((group, groupIndex) => (
                <g
                  key={group.key}
                  opacity={hovered == null || hovered === groupIndex ? 1 : 0.5}
                >
                  {series.map(({ key, color }, seriesIndex) => {
                    const value = group[key];
                    if (value == null) {
                      return null;
                    }
                    const top = Math.min(plot.yAt(value), plot.zeroY);
                    const barHeight = Math.max(Math.abs(plot.yAt(value) - plot.zeroY), 1);
                    const positive = value >= 0;
                    return (
                      <path
                        key={key}
                        d={roundedBarPath(
                          plot.barX(groupIndex, seriesIndex),
                          top,
                          plot.barWidth,
                          barHeight,
                          4,
                          positive
                            ? { topLeft: true, topRight: true }
                            : { bottomLeft: true, bottomRight: true },
                        )}
                        fill={color}
                      />
                    );
                  })}
                  <text
                    x={margin.left + groupIndex * plot.band + plot.band / 2}
                    y={height - 6}
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    textAnchor="middle"
                  >
                    {group.label}
                  </text>
                  <rect
                    x={margin.left + groupIndex * plot.band}
                    y={margin.top}
                    width={plot.band}
                    height={height - margin.top - margin.bottom}
                    fill="transparent"
                    onPointerEnter={() => setHovered(groupIndex)}
                  />
                </g>
              ))}
            </>
          ) : null}
        </svg>

        {plot && hoveredGroup && hovered != null ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-48 rounded-md border p-2.5 text-xs shadow-md"
            style={{
              top: 8,
              left: Math.min(
                Math.max(margin.left + hovered * plot.band + plot.band / 2 - 96, 0),
                Math.max(width - 200, 0),
              ),
            }}
          >
            <div className="font-medium">{hoveredGroup.label}</div>
            {series.map(({ key, label, color }) => (
              <div key={key} className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{label}</span>
                </span>
                <span className="tabular-nums font-medium">
                  {hoveredGroup[key] != null ? hoveredGroup[key].toFixed(2) : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ChartLegend
        items={series.map(({ label, color }) => ({ label, color, mark: "rect" as const }))}
      />
    </div>
  );
}
