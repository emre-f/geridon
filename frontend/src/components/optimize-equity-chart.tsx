import { useMemo, useState } from "react";

import { formatDate } from "@/lib/format";
import { niceTicks } from "@/lib/chart-scale";
import { seriesColors } from "@/lib/optimize-chart-utils";
import {
  linePath,
  nearestEquityPoint,
  type EquityChartData,
  type EquityHoverPoint,
} from "@/lib/optimize-candidate-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 16, right: 14, bottom: 24, left: 44 };
const height = 200;

function SymbolEquityPlot({
  data,
  timeframe,
  candidateLabel,
  showSymbol,
}: {
  data: EquityChartData;
  timeframe: string;
  candidateLabel: string;
  showSymbol: boolean;
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<EquityHoverPoint | null>(null);

  const plot = useMemo(() => {
    const points = data.folds.flatMap((fold) => [...fold.candidate, ...fold.baseline]);
    if (points.length === 0 || width <= 0) {
      return null;
    }
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = 0;
    let yMax = 0;
    for (const point of points) {
      xMin = Math.min(xMin, point.timestamp_ms);
      xMax = Math.max(xMax, point.timestamp_ms);
      yMin = Math.min(yMin, point.returnPct);
      yMax = Math.max(yMax, point.returnPct);
    }
    const pad = (yMax - yMin || 1) * 0.08;
    yMin -= pad;
    yMax += pad;

    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const xAt = (timestamp: number) =>
      margin.left + ((timestamp - xMin) / (xMax - xMin || 1)) * innerWidth;
    const yAt = (value: number) =>
      margin.top + ((yMax - value) / (yMax - yMin)) * (height - margin.top - margin.bottom);
    const tAt = (x: number) => xMin + ((x - margin.left) / innerWidth) * (xMax - xMin);
    return {
      innerWidth,
      xAt,
      yAt,
      tAt,
      yTicks: niceTicks(yMin, yMax).map((value) => ({ value, y: yAt(value) })),
    };
  }, [data, width]);

  const multiFold = data.folds.length > 1;

  return (
    <div ref={containerRef} className="relative w-full">
      {showSymbol ? <p className="text-muted-foreground px-1 text-xs">{data.symbol}</p> : null}
      <svg
        role="img"
        aria-label={`Validation equity for ${data.symbol}`}
        width="100%"
        height={height}
        viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          if (plot) {
            setHover(nearestEquityPoint(data.folds, plot.tAt(event.nativeEvent.offsetX)));
          }
        }}
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
                  {tick.value.toFixed(Math.abs(tick.value) < 10 ? 1 : 0)}%
                </text>
              </g>
            ))}

            {data.folds.map((fold) => {
              const reference = fold.candidate.length > 0 ? fold.candidate : fold.baseline;
              if (reference.length === 0) {
                return null;
              }
              const from = plot.xAt(reference[0].timestamp_ms);
              const to = plot.xAt(reference[reference.length - 1].timestamp_ms);
              return (
                <g key={fold.foldIndex}>
                  {multiFold && fold.foldIndex > 0 ? (
                    <line
                      x1={from}
                      x2={from}
                      y1={margin.top}
                      y2={height - margin.bottom}
                      stroke="var(--border)"
                      strokeWidth={1}
                    />
                  ) : null}
                  {multiFold ? (
                    <text
                      x={(from + to) / 2}
                      y={margin.top - 5}
                      fontSize={10}
                      fill="var(--muted-foreground)"
                      textAnchor="middle"
                    >
                      F{fold.foldIndex + 1}
                    </text>
                  ) : null}
                  <path
                    d={linePath(fold.baseline, plot.xAt, plot.yAt)}
                    fill="none"
                    stroke={seriesColors.baseline}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={linePath(fold.candidate, plot.xAt, plot.yAt)}
                    fill="none"
                    stroke={seriesColors.candidate}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {hover ? (
              <line
                x1={plot.xAt(hover.timestamp_ms)}
                x2={plot.xAt(hover.timestamp_ms)}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                opacity={0.7}
              />
            ) : null}
          </>
        ) : null}
      </svg>

      {plot && hover ? (
        <div
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-44 rounded-md border p-2.5 text-xs shadow-md"
          style={{
            top: 8,
            left: Math.min(Math.max(plot.xAt(hover.timestamp_ms) - 88, 0), Math.max(width - 184, 0)),
          }}
        >
          <div className="font-medium">
            {formatDate(hover.timestamp_ms, timeframe)}
            {multiFold ? ` · fold ${hover.foldIndex + 1}` : ""}
          </div>
          {[
            { label: candidateLabel, color: seriesColors.candidate, value: hover.candidate },
            { label: "Baseline", color: seriesColors.baseline, value: hover.baseline },
          ].map((row) => (
            <div key={row.label} className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                <span
                  className="h-0.5 w-3 shrink-0"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="tabular-nums font-medium">
                {row.value != null ? `${row.value.toFixed(2)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OptimizeEquityChart({
  data,
  timeframe,
  candidateLabel,
}: {
  data: EquityChartData[];
  timeframe: string;
  candidateLabel: string;
}) {
  if (data.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((symbolData) => (
        <SymbolEquityPlot
          key={symbolData.symbol}
          data={symbolData}
          timeframe={timeframe}
          candidateLabel={candidateLabel}
          showSymbol={data.length > 1}
        />
      ))}
      <ChartLegend
        items={[
          { label: candidateLabel, color: seriesColors.candidate, mark: "line" },
          { label: "Baseline", color: seriesColors.baseline, mark: "line" },
        ]}
      />
    </div>
  );
}
