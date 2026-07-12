import { useMemo, useState } from "react";

import { niceTicks } from "@/lib/chart-scale";
import { formatSampledValue, seriesColors } from "@/lib/optimize-chart-utils";
import type { SensitivityPanel, SensitivityPoint } from "@/lib/optimize-sensitivity-utils";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 8, right: 10, bottom: 20, left: 38 };
const height = 150;

const legendItems = [
  { label: "Eligible", color: seriesColors.candidate, mark: "dot" as const },
  { label: "Ineligible", color: "var(--muted-foreground)", mark: "dot" as const },
  { label: "Baseline value", color: "var(--muted-foreground)", mark: "dashed" as const },
];

function PanelChart({
  panel,
  domain,
}: {
  panel: SensitivityPanel;
  domain: { min: number; max: number };
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<SensitivityPoint | null>(null);

  const plot = useMemo(() => {
    if (width <= 0) {
      return null;
    }
    const span = panel.max - panel.min || 1;
    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = height - margin.top - margin.bottom;
    const xAt = (value: number) => margin.left + ((value - panel.min) / span) * innerWidth;
    const yAt = (score: number) =>
      margin.top + ((domain.max - score) / (domain.max - domain.min)) * innerHeight;
    return {
      innerWidth,
      xAt,
      yAt,
      xTicks: niceTicks(panel.min, panel.max, 3).filter(
        (tick) => tick >= panel.min && tick <= panel.max,
      ),
      yTicks: niceTicks(domain.min, domain.max, 3),
    };
  }, [domain, panel, width]);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground px-1 text-xs font-medium">{panel.label}</p>
      <div ref={containerRef} className="relative w-full">
        <svg
          role="img"
          aria-label={`Score by sampled ${panel.label} value`}
          width="100%"
          height={height}
          viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
          onPointerLeave={() => setHovered(null)}
        >
          {plot ? (
            <>
              {plot.yTicks.map((tick) => (
                <g key={tick}>
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
                  key={tick}
                  x={plot.xAt(tick)}
                  y={height - 6}
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  textAnchor="middle"
                >
                  {formatSampledValue(tick)}
                </text>
              ))}

              <line
                x1={plot.xAt(panel.current)}
                x2={plot.xAt(panel.current)}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeWidth={1}
                opacity={0.7}
              />

              {panel.points.map((point) => (
                <circle
                  key={point.trialIndex}
                  cx={plot.xAt(point.value)}
                  cy={plot.yAt(point.score)}
                  r={hovered?.trialIndex === point.trialIndex ? 4.5 : 3}
                  fill={point.eligible ? seriesColors.candidate : "var(--muted-foreground)"}
                  stroke="var(--card)"
                  strokeWidth={1}
                  opacity={point.eligible ? 0.9 : 0.55}
                  onPointerEnter={() => setHovered(point)}
                />
              ))}
            </>
          ) : null}
        </svg>

        {plot && hovered ? (
          <div
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-40 rounded-md border p-2 text-xs shadow-md"
            style={{
              top: 4,
              left: Math.min(Math.max(plot.xAt(hovered.value) - 80, 0), Math.max(width - 160, 0)),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Trial {hovered.trialIndex}</span>
              <span className="tabular-nums">{hovered.score.toFixed(2)}</span>
            </div>
            <div className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2">
              <span>{panel.label}</span>
              <span className="tabular-nums">{formatSampledValue(hovered.value)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OptimizeSensitivityChart({
  panels,
  domain,
}: {
  panels: SensitivityPanel[];
  domain: { min: number; max: number };
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {panels.map((panel) => (
          <PanelChart key={panel.nodeId} panel={panel} domain={domain} />
        ))}
      </div>
      <ChartLegend items={legendItems} />
    </div>
  );
}
