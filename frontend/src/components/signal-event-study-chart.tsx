import { useMemo, useState } from "react";

import type { EventStudyResult } from "@/lib/api-client-signals-registry";
import { niceTicks } from "@/lib/chart-scale";
import { formatReturnValue, formatScaledTick, formatTStat, returnScaleFor } from "@/lib/signal-lab-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 16, right: 14, bottom: 24, left: 48 };
const height = 260;

const signalColor = "var(--viz-candidate)";
const baselineColor = "var(--viz-baseline)";

const legendItems = [
  { label: "Signal events", color: signalColor, mark: "line" as const },
  { label: "Matched baseline", color: baselineColor, mark: "line" as const },
  {
    label: "95% band on the gap",
    color: "color-mix(in srgb, var(--viz-candidate) 30%, transparent)",
    mark: "rect" as const,
  },
];

function segmentedPath(
  points: Array<{ x: number; y: number | null }>,
): string {
  let path = "";
  let drawing = false;
  for (const point of points) {
    if (point.y == null) {
      drawing = false;
      continue;
    }
    path += `${drawing ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    drawing = true;
  }
  return path;
}

function bandSegments(
  points: Array<{ x: number; low: number | null; high: number | null }>,
): string[] {
  const segments: string[] = [];
  let current: Array<{ x: number; low: number; high: number }> = [];
  const flush = () => {
    if (current.length > 1) {
      const top = current.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.high.toFixed(2)}`);
      const bottom = [...current].reverse().map((p) => `L${p.x.toFixed(2)},${p.low.toFixed(2)}`);
      segments.push(`${top.join("")}${bottom.join("")}Z`);
    }
    current = [];
  };
  for (const point of points) {
    if (point.low == null || point.high == null) {
      flush();
    } else {
      current.push({ x: point.x, low: point.low, high: point.high });
    }
  }
  flush();
  return segments;
}

export function SignalEventStudyChart({ study }: { study: EventStudyResult }) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const plot = useMemo(() => {
    const curve = study.curve;
    if (curve.length === 0 || width <= 0) {
      return null;
    }
    const rawValues: number[] = [0];
    for (const point of curve) {
      for (const value of [point.signal_mean, point.baseline_mean]) {
        if (value != null) {
          rawValues.push(value);
        }
      }
      if (point.baseline_mean != null && point.gap_lower != null && point.gap_upper != null) {
        rawValues.push(point.baseline_mean + point.gap_lower, point.baseline_mean + point.gap_upper);
      }
    }
    const { unit, scale } = returnScaleFor(Math.max(...rawValues.map(Math.abs)));
    let min = Math.min(...rawValues) * scale;
    let max = Math.max(...rawValues) * scale;
    const pad = (max - min || 1) * 0.08;
    min -= pad;
    max += pad;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const maxHorizon = curve[curve.length - 1].horizon;
    const xAt = (horizon: number) =>
      margin.left + ((horizon - 1) / Math.max(maxHorizon - 1, 1)) * innerWidth;
    const yAt = (raw: number) => margin.top + ((max - raw * scale) / (max - min)) * innerHeight;

    const linePoints = (pick: (point: (typeof curve)[number]) => number | null) =>
      curve.map((point) => ({
        x: xAt(point.horizon),
        y: pick(point) == null ? null : yAt(pick(point) as number),
      }));

    return {
      unit,
      innerWidth,
      xAt,
      yAt,
      maxHorizon,
      signalPath: segmentedPath(linePoints((p) => p.signal_mean)),
      baselinePath: segmentedPath(linePoints((p) => p.baseline_mean)),
      bandPaths: bandSegments(
        curve.map((point) => ({
          x: xAt(point.horizon),
          low:
            point.baseline_mean == null || point.gap_lower == null
              ? null
              : yAt(point.baseline_mean + point.gap_lower),
          high:
            point.baseline_mean == null || point.gap_upper == null
              ? null
              : yAt(point.baseline_mean + point.gap_upper),
        })),
      ),
      xTicks: [1, 5, 10, 21, 42, 63].filter((tick) => tick <= maxHorizon),
      yTicks: niceTicks(min, max).map((value) => ({
        value,
        y: margin.top + ((max - value) / (max - min)) * innerHeight,
      })),
    };
  }, [study, width]);

  if (study.curve.length === 0) {
    return <p className="text-muted-foreground text-sm">No study curve to plot.</p>;
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!plot) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    let nearest = 0;
    study.curve.forEach((point, index) => {
      if (Math.abs(plot.xAt(point.horizon) - x) < Math.abs(plot.xAt(study.curve[nearest].horizon) - x)) {
        nearest = index;
      }
    });
    setHovered(nearest);
  }

  const hoveredPoint = hovered != null ? study.curve[hovered] : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label="Mean cumulative market-adjusted return after the event, signal versus matched baseline with a 95% band on the gap"
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
              {plot.xTicks.map((tick) => (
                <text key={tick} x={plot.xAt(tick)} y={height - 6} fontSize={11} fill="var(--muted-foreground)" textAnchor="middle">
                  {tick}
                </text>
              ))}

              {plot.bandPaths.map((path) => (
                <path key={path} d={path} fill={signalColor} opacity={0.12} />
              ))}
              <path d={plot.baselinePath} fill="none" stroke={baselineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <path d={plot.signalPath} fill="none" stroke={signalColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {hoveredPoint ? (
                <line
                  x1={plot.xAt(hoveredPoint.horizon)}
                  x2={plot.xAt(hoveredPoint.horizon)}
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
              left: Math.min(Math.max(plot.xAt(hoveredPoint.horizon) - 112, 0), Math.max(width - 232, 0)),
            }}
          >
            <div className="font-medium">{hoveredPoint.horizon} bars after entry</div>
            <dl className="mt-1 space-y-0.5">
              {[
                { label: "Signal", value: formatReturnValue(hoveredPoint.signal_mean) },
                { label: "Baseline", value: formatReturnValue(hoveredPoint.baseline_mean) },
                { label: "Gap", value: formatReturnValue(hoveredPoint.gap) },
                {
                  label: "95% band",
                  value:
                    hoveredPoint.gap_lower == null || hoveredPoint.gap_upper == null
                      ? "—"
                      : `${formatReturnValue(hoveredPoint.gap_lower)} to ${formatReturnValue(hoveredPoint.gap_upper)}`,
                },
                { label: "Gap t-stat", value: formatTStat(hoveredPoint.gap_t_stat) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="tabular-nums font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ChartLegend items={legendItems} />
        <span className="text-muted-foreground px-1 text-xs">x: trading days held</span>
      </div>
    </div>
  );
}
