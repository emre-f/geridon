import { useMemo, useState } from "react";

import type { AblationEntry } from "@/lib/api-optimization-types";
import { niceTicks, roundedBarPath } from "@/lib/chart-scale";
import { ablationRows } from "@/lib/optimize-candidate-utils";
import { seriesColors } from "@/lib/optimize-chart-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 4, right: 48, bottom: 22, left: 88 };
const rowBand = 30;
const barHeight = 18;

const colors = {
  improves: seriesColors.candidate,
  hurts: "var(--viz-penalty-drawdown)",
};

export function OptimizeAblationChart({ entries }: { entries: AblationEntry[] }) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const { bars, skipped } = useMemo(() => ablationRows(entries), [entries]);
  const height = margin.top + bars.length * rowBand + margin.bottom;

  const plot = useMemo(() => {
    if (bars.length === 0 || width <= 0) {
      return null;
    }
    let min = 0;
    let max = 0;
    for (const bar of bars) {
      min = Math.min(min, bar.delta);
      max = Math.max(max, bar.delta);
    }
    const pad = (max - min || 1) * 0.08;
    min = min < 0 ? min - pad : min;
    max = max > 0 ? max + pad : max;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const xAt = (value: number) => margin.left + ((value - min) / (max - min)) * innerWidth;
    return { xAt, xTicks: niceTicks(min, max, 5) };
  }, [bars, width]);

  if (bars.length === 0 && skipped.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {bars.length > 0 ? (
        <div ref={containerRef} className="relative w-full">
          <svg
            role="img"
            aria-label="Score change when disabling one rule at a time"
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
                      {tick.toFixed(Math.abs(tick) < 10 ? 2 : 0)}
                    </text>
                  </g>
                ))}

                {bars.map((bar, index) => {
                  const y = margin.top + index * rowBand + (rowBand - barHeight) / 2;
                  const zero = plot.xAt(0);
                  const end = plot.xAt(bar.delta);
                  const positive = bar.delta >= 0;
                  return (
                    <g key={bar.ruleId} opacity={hovered == null || hovered === index ? 1 : 0.45}>
                      <text
                        x={margin.left - 8}
                        y={y + barHeight / 2 + 3.5}
                        fontSize={11}
                        fill="var(--muted-foreground)"
                        textAnchor="end"
                      >
                        {bar.label}
                      </text>
                      <path
                        d={roundedBarPath(
                          Math.min(zero, end),
                          y,
                          Math.max(Math.abs(end - zero), 1),
                          barHeight,
                          4,
                          positive
                            ? { topRight: true, bottomRight: true }
                            : { topLeft: true, bottomLeft: true },
                        )}
                        fill={positive ? colors.improves : colors.hurts}
                      />
                      <text
                        x={positive ? end + 6 : end - 6}
                        y={y + barHeight / 2 + 3.5}
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--foreground)"
                        textAnchor={positive ? "start" : "end"}
                      >
                        {`${bar.delta >= 0 ? "+" : ""}${bar.delta.toFixed(2)}`}
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
              className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-56 rounded-md border p-2.5 text-xs shadow-md"
              style={{
                top: Math.min(margin.top + hovered * rowBand + rowBand, height - 110),
                left: Math.max(width - 240, 0),
              }}
            >
              <div className="font-medium break-words">{bars[hovered].summary}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Score without rule</span>
                <span className="tabular-nums">{bars[hovered].ablatedScore.toFixed(2)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Change</span>
                <span className="tabular-nums font-medium">
                  {`${bars[hovered].delta >= 0 ? "+" : ""}${bars[hovered].delta.toFixed(2)}`}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ChartLegend
        items={[
          { label: "Score improves without the rule", color: colors.improves, mark: "rect" },
          { label: "Score drops without the rule", color: colors.hurts, mark: "rect" },
        ]}
      />

      {skipped.map((entry) => (
        <p key={entry.ruleId} className="text-muted-foreground px-1 text-xs">
          {entry.summary} (not ablated{entry.skipReason ? `: ${entry.skipReason}` : ""})
        </p>
      ))}
    </div>
  );
}
