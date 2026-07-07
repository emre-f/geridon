import type { RefObject } from "react";

import { formatCompact, formatCurrency, formatDate, formatPercent } from "@/lib/format";
import {
  margin,
  markerRadius,
  markerStrokeWidth,
  selectionGuideOpacity,
  selectionGuideStroke,
  type ChartMode,
  type ChartPoint,
} from "@/components/stock-chart/chart-types";
import { clamp } from "@/components/stock-chart/chart-types";

export interface ChartMeasurement {
  start: ChartPoint;
  end: ChartPoint;
  change: number;
  percent: number;
}

interface ChartGuidesProps {
  isDragging: boolean;
  dragStartPoint: ChartPoint | null;
  dragEndPoint: ChartPoint | null;
  activePoint: ChartPoint | null;
  mode: ChartMode;
  trendColor: string;
  plotWidth: number;
  height: number;
}

/** Crosshair guides for the hovered candle, or the two guide lines while measuring. */
export function ChartGuides({
  isDragging,
  dragStartPoint,
  dragEndPoint,
  activePoint,
  mode,
  trendColor,
  plotWidth,
  height,
}: ChartGuidesProps) {
  return (
    <>
      {isDragging && dragStartPoint && dragEndPoint ? (
        <g>
          {[dragStartPoint, dragEndPoint].map((point, index) => (
            <line
              key={`${point.candle.timestamp_ms}-${index}`}
              x1={point.x}
              x2={point.x}
              y1={margin.top}
              y2={height - margin.bottom}
              stroke={selectionGuideStroke}
              strokeDasharray="4 4"
              opacity={selectionGuideOpacity}
            />
          ))}
        </g>
      ) : activePoint ? (
        <g>
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={margin.top}
            y2={height - margin.bottom}
            stroke={selectionGuideStroke}
            strokeDasharray="4 4"
            opacity={selectionGuideOpacity}
          />
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={activePoint.closeY}
            y2={activePoint.closeY}
            stroke={selectionGuideStroke}
            strokeDasharray="4 4"
            opacity="0.45"
          />
        </g>
      ) : null}

      {isDragging && dragStartPoint && dragEndPoint && mode === "line" ? (
        <g>
          {[dragStartPoint, dragEndPoint].map((point, index) => (
            <circle
              key={`${point.candle.timestamp_ms}-${index}`}
              cx={point.x}
              cy={point.closeY}
              r={markerRadius}
              fill={trendColor}
              stroke={trendColor}
              strokeWidth={markerStrokeWidth}
            />
          ))}
        </g>
      ) : activePoint && mode === "line" ? (
        <circle
          cx={activePoint.x}
          cy={activePoint.closeY}
          r={markerRadius}
          fill={trendColor}
          stroke={trendColor}
          strokeWidth={markerStrokeWidth}
        />
      ) : null}
    </>
  );
}

interface ChartTooltipProps {
  tooltipRef: RefObject<HTMLDivElement | null>;
  activePoint: ChartPoint;
  measurement: ChartMeasurement | null;
  timeframe: string;
  tooltipY: number;
  tooltipWidth: number;
  tooltipLeftMax: number;
}

/** OHLCV readout for the hovered candle, or the change summary while measuring. */
export function ChartTooltip({
  tooltipRef,
  activePoint,
  measurement,
  timeframe,
  tooltipY,
  tooltipWidth,
  tooltipLeftMax,
}: ChartTooltipProps) {
  return (
    <div
      ref={tooltipRef}
      className="bg-popover text-popover-foreground pointer-events-none absolute z-20 rounded-md border px-3 py-2 text-[11px] shadow-md transition-[left,top,width] duration-200 ease-out"
      style={{
        top: tooltipY,
        width: tooltipWidth,
        left: clamp(activePoint.x - tooltipWidth / 2, 8, tooltipLeftMax),
      }}
    >
      {measurement ? (
        <div>
          <div
            className={
              measurement.change >= 0
                ? "font-medium text-[var(--chart-up)]"
                : "font-medium text-[var(--chart-down)]"
            }
          >
            {measurement.change >= 0 ? "+" : ""}
            {formatCurrency(measurement.change)} ({formatPercent(measurement.percent)})
          </div>
          <div className="text-muted-foreground mt-1">
            {formatDate(measurement.start.candle.timestamp_ms, timeframe)} -{" "}
            {formatDate(measurement.end.candle.timestamp_ms, timeframe)}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-1 font-medium">
            {formatDate(activePoint.candle.timestamp_ms, timeframe)}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Open</span>
            <span className="text-right">{formatCurrency(activePoint.candle.open)}</span>
            <span className="text-muted-foreground">High</span>
            <span className="text-right">{formatCurrency(activePoint.candle.high)}</span>
            <span className="text-muted-foreground">Low</span>
            <span className="text-right">{formatCurrency(activePoint.candle.low)}</span>
            <span className="text-muted-foreground">Close</span>
            <span className="text-right">{formatCurrency(activePoint.candle.close)}</span>
            <span className="text-muted-foreground">Volume</span>
            <span className="text-right">{formatCompact(activePoint.candle.volume)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
