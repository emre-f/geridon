import { margin, type IndicatorPaneChart } from "@/components/stock-chart/chart-types";
import { formatIndicatorNumber } from "@/components/stock-chart/indicator-visuals";

interface ChartPanesProps {
  panes: IndicatorPaneChart[];
  plotWidth: number;
  width: number;
}

/** Sub-panes below the price plot: bordered bands with ticks, guides, bars, and lines. */
export function ChartPanes({ panes, plotWidth, width }: ChartPanesProps) {
  return (
    <>
      {panes.map((pane) => (
        <g key={pane.id}>
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={pane.top}
            y2={pane.top}
            stroke="var(--border)"
          />
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={pane.top + pane.height}
            y2={pane.top + pane.height}
            stroke="var(--border)"
          />
          <text
            x={margin.left + 4}
            y={pane.top + 13}
            className="fill-muted-foreground text-[11px] font-medium"
          >
            {pane.label}
          </text>
          {pane.ticks.map((tick) => {
            const y = pane.valueToY(tick);

            return (
              <g key={`${pane.id}-${tick}`}>
                <line
                  x1={margin.left}
                  x2={margin.left + plotWidth}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  opacity="0.65"
                />
                <text
                  x={width - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatIndicatorNumber(tick)}
                </text>
              </g>
            );
          })}
          {pane.guides.map((guide) => (
            <line
              key={`${pane.id}-guide-${guide}`}
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={pane.valueToY(guide)}
              y2={pane.valueToY(guide)}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              opacity="0.45"
            />
          ))}
          {pane.histogramBars.map((bar) => (
            <rect
              key={bar.key}
              x={bar.x - bar.width / 2}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx="1"
              fill={bar.color}
              fillOpacity={bar.opacity}
            />
          ))}
          {pane.lines.map((line) =>
            line.paths.map((path, pathIndex) => (
              <path
                key={`${line.key}-${pathIndex}`}
                d={path}
                fill="none"
                stroke={line.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={line.width}
                strokeDasharray={line.dashArray}
                opacity={line.opacity}
              />
            )),
          )}
        </g>
      ))}
    </>
  );
}
