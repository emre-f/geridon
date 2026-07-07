import type { ChartMode, ChartPoint } from "@/components/stock-chart/chart-types";
import type { ChartLayout } from "@/components/stock-chart/build-chart-layout";

interface ChartPriceLayersProps {
  chart: ChartLayout;
  mode: ChartMode;
  animatedPoints: ChartPoint[];
  closeLinePath: string;
  closeAreaPath: string;
  selectedAreaPath: string;
  trendColor: string;
  trendMutedColor: string;
}

function VolumeBars({ chart }: { chart: ChartLayout }) {
  return (
    <>
      {chart.volumeBars.map((bar) => (
        <rect
          key={bar.key}
          x={bar.x - bar.width / 2}
          y={bar.y}
          width={bar.width}
          height={Math.max(bar.height, 1)}
          rx="1"
          fill={bar.rising ? "var(--chart-up-muted)" : "var(--chart-down-muted)"}
        />
      ))}
    </>
  );
}

/** The price plot itself (candles or line), volume, indicator overlays, and signal markers. */
export function ChartPriceLayers({
  chart,
  mode,
  animatedPoints,
  closeLinePath,
  closeAreaPath,
  selectedAreaPath,
  trendColor,
  trendMutedColor,
}: ChartPriceLayersProps) {
  return (
    <>
      {mode === "candle" ? (
        <g>
          {chart.points.map((point) => (
            <g key={point.candle.timestamp_ms}>
              <line
                x1={point.x}
                x2={point.x}
                y1={point.highY}
                y2={point.lowY}
                stroke={point.rising ? "var(--chart-up)" : "var(--chart-down)"}
                strokeWidth="1.4"
              />
              <rect
                x={point.x - chart.candleWidth / 2}
                y={Math.min(point.openY, point.closeY)}
                width={chart.candleWidth}
                height={Math.max(Math.abs(point.closeY - point.openY), 1)}
                rx="1"
                fill={point.rising ? "var(--chart-up)" : "var(--chart-down)"}
              />
            </g>
          ))}
          <VolumeBars chart={chart} />
        </g>
      ) : (
        <g>
          <VolumeBars chart={chart} />
          <path d={closeAreaPath} fill={trendMutedColor} opacity="0.18" />
          {selectedAreaPath ? (
            <path d={selectedAreaPath} fill={trendMutedColor} opacity="0.28" />
          ) : null}
          <path
            d={closeLinePath}
            fill="none"
            stroke={trendColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          {animatedPoints.length === 1 ? (
            <circle
              cx={animatedPoints[0].x}
              cy={animatedPoints[0].closeY}
              r="3"
              fill={trendColor}
            />
          ) : null}
        </g>
      )}

      {[...chart.volumeLines, ...chart.overlayLines].map((line) =>
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

      {chart.signalMarkers.length > 0 ? (
        <g pointerEvents="none">
          {chart.signalMarkers.map((marker) => (
            <polygon
              key={marker.key}
              points={marker.points}
              fill={marker.side === "buy" ? "var(--chart-up)" : "var(--chart-down)"}
              stroke="var(--card)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ) : null}
    </>
  );
}
