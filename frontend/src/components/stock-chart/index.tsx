import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Candle, IndicatorSeries, StrategySignal } from "@/lib/api";
import { useElementSize } from "@/hooks/use-element-size";
import { Skeleton } from "@/components/ui/skeleton";
import {
  chartFrameClass,
  hoverTooltipHeightEstimate,
  hoverTooltipWidth,
  margin,
  measureCursor,
  measurementTooltipHeightEstimate,
  measurementTooltipWidth,
  tooltipGap,
  type ChartMode,
  type ChartTone,
} from "@/components/stock-chart/chart-types";
import { areaPath, linePath } from "@/components/stock-chart/chart-geometry";
import { indicatorValueMaps } from "@/components/stock-chart/indicator-visuals";
import { buildChartLayout, type ChartLayout } from "@/components/stock-chart/build-chart-layout";
import { useAnimatedChartPoints } from "@/components/stock-chart/use-animated-chart-points";
import { useChartInteraction } from "@/components/stock-chart/use-chart-interaction";
import { ChartGrid } from "@/components/stock-chart/chart-grid";
import { ChartPanes } from "@/components/stock-chart/chart-panes";
import { ChartPriceLayers } from "@/components/stock-chart/chart-price-layers";
import {
  ChartGuides,
  ChartTooltip,
  type ChartMeasurement,
} from "@/components/stock-chart/chart-hover-overlay";

export type { ChartMode, ChartTone } from "@/components/stock-chart/chart-types";

// Stable default identities: inline [] defaults would recreate arrays each
// render and defeat the memoized layout.
const noIndicators: IndicatorSeries[] = [];
const noSignals: StrategySignal[] = [];

interface StockChartProps {
  candles: Candle[];
  indicators?: IndicatorSeries[];
  signals?: StrategySignal[];
  timeframe: string;
  visibleStartMs?: number;
  visibleEndMs?: number;
  mode: ChartMode;
  tone?: ChartTone;
  loading?: boolean;
  onVisibleCandlesChange?: (candles: Candle[]) => void;
  onHoverCandleChange?: (candle: Candle | null) => void;
}

function StockChartImpl({
  candles,
  indicators = noIndicators,
  signals = noSignals,
  timeframe,
  visibleStartMs,
  visibleEndMs,
  mode,
  tone = "up",
  loading = false,
  onVisibleCandlesChange,
  onHoverCandleChange,
}: StockChartProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layoutRef = useRef<ChartLayout | null>(null);
  const [measuredTooltipHeight, setMeasuredTooltipHeight] = useState(0);
  const measuredWidth = Math.floor(size.width);
  const measuredHeight = Math.floor(size.height);
  const width = Math.max(measuredWidth, 320);
  const height = Math.max(measuredHeight, 400);

  const interaction = useChartInteraction({
    candles,
    timeframe,
    mode,
    visibleStartMs,
    visibleEndMs,
    svgRef,
    layoutRef,
    onVisibleCandlesChange,
    onHoverCandleChange,
  });
  const { visibleCandles, hoverIndex, hoverOnLine, dragStartIndex, dragEndIndex, isPanning } =
    interaction;

  const indicatorMaps = useMemo(() => indicatorValueMaps(indicators), [indicators]);
  const signalsByTimestamp = useMemo(() => {
    const map = new Map<number, StrategySignal[]>();
    for (const signal of signals) {
      const current = map.get(signal.timestamp_ms) ?? [];
      current.push(signal);
      map.set(signal.timestamp_ms, current);
    }
    return map;
  }, [signals]);

  const chart = useMemo(
    () =>
      buildChartLayout({
        width,
        height,
        mode,
        visibleCandles,
        indicators,
        indicatorMaps,
        signalsByTimestamp,
      }),
    [height, indicatorMaps, indicators, mode, signalsByTimestamp, visibleCandles, width],
  );
  // Latest-layout ref for the interaction hook's event handlers.
  layoutRef.current = chart;

  const animatedPoints = useAnimatedChartPoints(chart.points, candles);
  const isDragging = dragStartIndex != null && dragEndIndex != null;
  const activeIndex = isDragging ? dragEndIndex : hoverIndex;
  const activePoint = activeIndex == null ? null : chart.points[activeIndex];
  const dragStartPoint = dragStartIndex == null ? null : chart.points[dragStartIndex];
  const dragEndPoint = dragEndIndex == null ? null : chart.points[dragEndIndex];
  const closeLinePath = linePath(animatedPoints);
  const closeAreaPath = areaPath(animatedPoints, margin.top + chart.plotHeight);
  const trendColor = tone === "down" ? "var(--chart-down)" : "var(--chart-up)";
  const trendMutedColor = tone === "down" ? "var(--chart-down-muted)" : "var(--chart-up-muted)";
  const hasSelection =
    dragStartIndex != null && dragEndIndex != null && dragStartIndex !== dragEndIndex;
  const selectionStartIndex =
    hasSelection && dragStartIndex != null && dragEndIndex != null
      ? Math.min(dragStartIndex, dragEndIndex)
      : null;
  const selectionEndIndex =
    hasSelection && dragStartIndex != null && dragEndIndex != null
      ? Math.max(dragStartIndex, dragEndIndex)
      : null;
  const selectedAreaPath =
    selectionStartIndex != null && selectionEndIndex != null
      ? areaPath(
          chart.points.slice(selectionStartIndex, selectionEndIndex + 1),
          margin.top + chart.plotHeight,
        )
      : "";
  const selectionChange =
    selectionStartIndex != null && selectionEndIndex != null
      ? chart.points[selectionEndIndex].candle.close - chart.points[selectionStartIndex].candle.close
      : 0;
  const measurement: ChartMeasurement | null =
    isDragging && selectionStartIndex != null && selectionEndIndex != null
      ? {
          start: chart.points[selectionStartIndex],
          end: chart.points[selectionEndIndex],
          change: selectionChange,
          percent:
            (selectionChange / chart.points[selectionStartIndex].candle.close) * 100,
        }
      : null;
  const tooltipWidth = Math.min(
    measurement ? measurementTooltipWidth : hoverTooltipWidth,
    Math.max(width - 16, 0),
  );
  const tooltipLeftMax = Math.max(8, width - tooltipWidth - 8);
  const tooltipHeight =
    measuredTooltipHeight ||
    (measurement ? measurementTooltipHeightEstimate : hoverTooltipHeightEstimate);
  const tooltipY = Math.max(8, margin.top - tooltipHeight - tooltipGap);

  useLayoutEffect(() => {
    const nextHeight = Math.ceil(tooltipRef.current?.getBoundingClientRect().height ?? 0);

    setMeasuredTooltipHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, [activePoint, measurement, tooltipWidth]);

  if (loading && candles.length === 0) {
    return <Skeleton className={chartFrameClass} />;
  }

  if (candles.length === 0) {
    return (
      <div className={`border-border bg-muted/30 flex ${chartFrameClass} items-center justify-center rounded-md border`}>
        <p className="text-muted-foreground text-sm">No candles for this selection.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${chartFrameClass} select-none`}
      aria-busy={loading}
    >
      {measuredWidth === 0 ? <Skeleton className="h-full w-full" /> : null}
      <svg
        ref={svgRef}
        className="h-full w-full touch-none overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${mode === "line" ? "Line" : "Candlestick"} chart with volume`}
        onPointerMove={interaction.handlePointerMove}
        onPointerDown={interaction.handlePointerDown}
        onPointerUp={interaction.handlePointerUp}
        onPointerCancel={interaction.handlePointerCancel}
        onPointerLeave={interaction.handlePointerLeave}
        style={{
          cursor: isPanning
            ? "grabbing"
            : isDragging || hoverOnLine
              ? measureCursor
              : interaction.canPan
                ? "grab"
                : "crosshair",
          display: measuredWidth === 0 ? "none" : undefined,
        }}
      >
        <rect width={width} height={height} rx="6" fill="var(--card)" />
        <ChartGrid
          width={width}
          height={height}
          timeframe={timeframe}
          priceMin={chart.priceMin}
          priceMax={chart.priceMax}
          plotWidth={chart.plotWidth}
          plotHeight={chart.plotHeight}
          volumeTop={chart.volumeTop}
          points={chart.points}
        />
        <ChartPriceLayers
          chart={chart}
          mode={mode}
          animatedPoints={animatedPoints}
          closeLinePath={closeLinePath}
          closeAreaPath={closeAreaPath}
          selectedAreaPath={selectedAreaPath}
          trendColor={trendColor}
          trendMutedColor={trendMutedColor}
        />
        <ChartPanes panes={chart.panes} plotWidth={chart.plotWidth} width={width} />
        <ChartGuides
          isDragging={isDragging}
          dragStartPoint={dragStartPoint}
          dragEndPoint={dragEndPoint}
          activePoint={activePoint}
          mode={mode}
          trendColor={trendColor}
          plotWidth={chart.plotWidth}
          height={height}
        />
      </svg>

      {activePoint ? (
        <ChartTooltip
          tooltipRef={tooltipRef}
          activePoint={activePoint}
          measurement={measurement}
          timeframe={timeframe}
          tooltipY={tooltipY}
          tooltipWidth={tooltipWidth}
          tooltipLeftMax={tooltipLeftMax}
        />
      ) : null}
    </div>
  );
}

export const StockChart = memo(StockChartImpl);
