import { useMemo, useState } from "react";

import type { PreflightSymbolTimeline } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ChartLegend } from "@/components/optimize-chart-legend";
import { useElementSize } from "@/hooks/use-element-size";

const margin = { top: 6, right: 8, bottom: 20, left: 40 };
const rowHeight = 14;
const rowGap = 5;

const roleColors = {
  train: "var(--viz-train)",
  validation: "var(--viz-validation)",
  holdout: "var(--viz-holdout)",
};

function SymbolTimeline({
  symbol,
  timeframe,
  showTicker,
}: {
  symbol: PreflightSymbolTimeline;
  timeframe: string;
  showTicker: boolean;
}) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const endMs = symbol.holdout ? symbol.holdout.end_ms : symbol.search_end_ms;
  const height = margin.top + symbol.folds.length * (rowHeight + rowGap) - rowGap + margin.bottom;

  const plot = useMemo(() => {
    if (width <= 0 || endMs <= symbol.search_start_ms) {
      return null;
    }
    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const xAt = (ms: number) =>
      margin.left + ((ms - symbol.search_start_ms) / (endMs - symbol.search_start_ms)) * innerWidth;
    return { innerWidth, xAt };
  }, [width, symbol.search_start_ms, endMs]);

  const rowY = (index: number) => margin.top + index * (rowHeight + rowGap);
  const hoveredFold = hovered != null ? symbol.folds[hovered] : null;

  return (
    <div ref={containerRef} className="relative w-full">
      {showTicker ? <div className="text-muted-foreground mb-1 text-xs font-medium">{symbol.ticker}</div> : null}
      <svg
        role="img"
        aria-label={`Search/train, validation, and sealed test windows for ${symbol.ticker}`}
        width="100%"
        height={height}
        viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
        onPointerLeave={() => setHovered(null)}
      >
        {plot ? (
          <>
            {symbol.holdout ? (
              <g>
                <rect
                  x={plot.xAt(symbol.holdout.start_ms)}
                  y={margin.top}
                  width={Math.max(plot.xAt(symbol.holdout.end_ms) - plot.xAt(symbol.holdout.start_ms), 2)}
                  height={height - margin.top - margin.bottom}
                  fill={roleColors.holdout}
                  opacity={0.22}
                  rx={3}
                />
                <line
                  x1={plot.xAt(symbol.holdout.start_ms)}
                  x2={plot.xAt(symbol.holdout.start_ms)}
                  y1={margin.top}
                  y2={height - margin.bottom}
                  stroke={roleColors.holdout}
                  strokeWidth={1.5}
                  strokeDasharray="3 2.5"
                />
              </g>
            ) : null}

            {symbol.folds.map((fold, index) => (
              <g key={fold.index} opacity={hovered == null || hovered === index ? 1 : 0.55}>
                <rect
                  x={plot.xAt(fold.train_start_ms)}
                  y={rowY(index)}
                  width={Math.max(plot.xAt(fold.train_end_ms) - plot.xAt(fold.train_start_ms), 2)}
                  height={rowHeight}
                  fill={roleColors.train}
                  opacity={0.38}
                  rx={3}
                />
                <rect
                  x={plot.xAt(fold.valid_start_ms) + 2}
                  y={rowY(index)}
                  width={Math.max(plot.xAt(fold.valid_end_ms) - plot.xAt(fold.valid_start_ms) - 2, 2)}
                  height={rowHeight}
                  fill={roleColors.validation}
                  rx={3}
                />
                <text
                  x={margin.left - 6}
                  y={rowY(index) + rowHeight / 2 + 3.5}
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  textAnchor="end"
                >
                  {`F${fold.index + 1}`}
                </text>
                <rect
                  x={margin.left}
                  y={rowY(index) - rowGap / 2}
                  width={plot.innerWidth}
                  height={rowHeight + rowGap}
                  fill="transparent"
                  onPointerEnter={() => setHovered(index)}
                />
              </g>
            ))}

            {[symbol.search_start_ms, endMs].map((ms, side) => (
              <text
                key={ms}
                x={plot.xAt(ms)}
                y={height - 6}
                fontSize={10}
                fill="var(--muted-foreground)"
                textAnchor={side === 0 ? "start" : "end"}
              >
                {formatDate(ms, timeframe)}
              </text>
            ))}
          </>
        ) : null}
      </svg>

      {plot && hoveredFold ? (
        <div
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-md border p-2.5 text-xs shadow-md"
          style={{ top: 0, right: 8 }}
        >
          <div className="font-medium">{`Fold ${hoveredFold.index + 1}`}</div>
          <div className="text-muted-foreground mt-1">
            {`Search/Train ${formatDate(hoveredFold.train_start_ms, timeframe)} to ${formatDate(hoveredFold.train_end_ms, timeframe)}`}
          </div>
          <div className="text-muted-foreground">
            {`Validation ${formatDate(hoveredFold.valid_start_ms, timeframe)} to ${formatDate(hoveredFold.valid_end_ms, timeframe)}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Labels the data roles of a draft experiment before it starts: expanding
 * Search/Train windows, the chronological Validation window of each fold, and
 * the Sealed Test region the optimizer never sees.
 */
export function OptimizeTimelinePreview({
  timeline,
  timeframe,
}: {
  timeline: PreflightSymbolTimeline[];
  timeframe: string;
}) {
  if (timeline.length === 0) {
    return null;
  }
  const hasHoldout = timeline.some((symbol) => symbol.holdout != null);
  return (
    <div className="flex flex-col gap-1.5">
      {timeline.map((symbol) => (
        <SymbolTimeline
          key={symbol.ticker}
          symbol={symbol}
          timeframe={timeframe}
          showTicker={timeline.length > 1}
        />
      ))}
      <ChartLegend
        items={[
          { label: "Search/Train", color: roleColors.train, mark: "rect" },
          { label: "Validation", color: roleColors.validation, mark: "rect" },
          ...(hasHoldout
            ? [{ label: "Sealed test", color: roleColors.holdout, mark: "rect" as const }]
            : []),
        ]}
      />
    </div>
  );
}
