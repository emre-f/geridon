import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Candle } from "@/lib/api";
import { formatCompact, formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { useElementSize } from "@/hooks/use-element-size";
import { Skeleton } from "@/components/ui/skeleton";

export type ChartMode = "line" | "candle";
export type ChartTone = "up" | "down";

interface StockChartProps {
  candles: Candle[];
  timeframe: string;
  visibleStartMs?: number;
  visibleEndMs?: number;
  mode: ChartMode;
  tone?: ChartTone;
  loading?: boolean;
  onVisibleCandlesChange?: (candles: Candle[]) => void;
}

interface ChartPoint {
  candle: Candle;
  x: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  rising: boolean;
}

interface VolumeBar {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rising: boolean;
}

interface Viewport {
  start: number;
  size: number;
}

interface PanDrag {
  pointerId: number;
  clientX: number;
  start: number;
}

const tooltipGap = 10;
const hoverTooltipHeightEstimate = 132;
const measurementTooltipHeightEstimate = 54;
const hoverTooltipWidth = 188;
const measurementTooltipWidth = 220;
const minVolumeSlotWidth = 3;
const minVisibleCandles = 18;
const wheelZoomSensitivity = 0.0015;
const selectionGuideStroke = "var(--muted-foreground)";
const selectionGuideOpacity = 0.5;
const markerRadius = 4.5;
const markerStrokeWidth = 2;
const chartFrameClass = "h-[clamp(400px,calc(100vh-18rem),560px)] w-full";
const chartMorphDurationMs = 320;
const margin = {
  top: 72,
  right: 76,
  bottom: 34,
  left: 10,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function viewportMinimum(totalCandles: number) {
  return Math.min(totalCandles, minVisibleCandles);
}

function viewportForWindow(candles: Candle[], startMs: number | undefined, endMs: number | undefined) {
  const totalCandles = candles.length;
  if (totalCandles === 0) {
    return { start: 0, size: 0 };
  }

  if (startMs == null || endMs == null) {
    return { start: 0, size: totalCandles };
  }

  const firstIndex = candles.findIndex((candle) => candle.timestamp_ms >= startMs);
  let lastIndexFromEnd = -1;

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].timestamp_ms <= endMs) {
      lastIndexFromEnd = index;
      break;
    }
  }

  if (firstIndex === -1 || lastIndexFromEnd === -1 || lastIndexFromEnd < firstIndex) {
    return { start: 0, size: totalCandles };
  }

  return {
    start: firstIndex,
    size: lastIndexFromEnd - firstIndex + 1,
  };
}

function nearestIndex(x: number, points: ChartPoint[]) {
  if (points.length <= 1) {
    return 0;
  }

  const firstX = points[0].x;
  const step = points[1].x - firstX;
  return clamp(Math.round((x - firstX) / step), 0, points.length - 1);
}

function priceTicks(min: number, max: number) {
  const ticks: number[] = [];
  const count = 5;

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    ticks.push(max - (max - min) * ratio);
  }

  return ticks;
}

function xTicks(points: ChartPoint[]) {
  if (points.length === 0) {
    return [];
  }

  const count = Math.min(6, points.length);
  const seen = new Set<number>();
  const ticks: ChartPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    const pointIndex = Math.round((index / Math.max(count - 1, 1)) * (points.length - 1));
    if (!seen.has(pointIndex)) {
      ticks.push(points[pointIndex]);
      seen.add(pointIndex);
    }
  }

  return ticks;
}

function linePath(points: ChartPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.closeY}`)
    .join(" ");
}

function areaPath(points: ChartPoint[], baseline: number) {
  if (points.length === 0) {
    return "";
  }

  return `${linePath(points)} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function sampledPoint(points: ChartPoint[], ratio: number) {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return points[0];
  }

  const rawIndex = ratio * (points.length - 1);
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.min(Math.ceil(rawIndex), points.length - 1);
  const amount = rawIndex - lowerIndex;
  const lower = points[lowerIndex];
  const upper = points[upperIndex];

  return {
    candle: amount < 0.5 ? lower.candle : upper.candle,
    x: lerp(lower.x, upper.x, amount),
    openY: lerp(lower.openY, upper.openY, amount),
    highY: lerp(lower.highY, upper.highY, amount),
    lowY: lerp(lower.lowY, upper.lowY, amount),
    closeY: lerp(lower.closeY, upper.closeY, amount),
    rising: amount < 0.5 ? lower.rising : upper.rising,
  };
}

function resamplePoints(sourcePoints: ChartPoint[], targetPoints: ChartPoint[]) {
  if (sourcePoints.length === 0 || targetPoints.length === 0) {
    return targetPoints;
  }

  return targetPoints.map((targetPoint, index) => {
    const ratio = targetPoints.length === 1 ? 0 : index / (targetPoints.length - 1);
    const sourcePoint = sampledPoint(sourcePoints, ratio) ?? targetPoint;

    return {
      ...targetPoint,
      x: sourcePoint.x,
      openY: sourcePoint.openY,
      highY: sourcePoint.highY,
      lowY: sourcePoint.lowY,
      closeY: sourcePoint.closeY,
    };
  });
}

function interpolatePoints(fromPoints: ChartPoint[], toPoints: ChartPoint[], amount: number) {
  return toPoints.map((targetPoint, index) => {
    const sourcePoint = fromPoints[index] ?? targetPoint;

    return {
      ...targetPoint,
      x: lerp(sourcePoint.x, targetPoint.x, amount),
      openY: lerp(sourcePoint.openY, targetPoint.openY, amount),
      highY: lerp(sourcePoint.highY, targetPoint.highY, amount),
      lowY: lerp(sourcePoint.lowY, targetPoint.lowY, amount),
      closeY: lerp(sourcePoint.closeY, targetPoint.closeY, amount),
    };
  });
}

function useAnimatedChartPoints(targetPoints: ChartPoint[]) {
  const [animatedPoints, setAnimatedPoints] = useState(targetPoints);
  const animatedPointsRef = useRef(targetPoints);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }

    if (reduceMotion || animatedPointsRef.current.length === 0 || targetPoints.length === 0) {
      animatedPointsRef.current = targetPoints;
      setAnimatedPoints(targetPoints);
      return;
    }

    const fromPoints = resamplePoints(animatedPointsRef.current, targetPoints);
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = easeOutCubic(clamp(elapsed / chartMorphDurationMs, 0, 1));
      const nextPoints = interpolatePoints(fromPoints, targetPoints, progress);

      animatedPointsRef.current = nextPoints;
      setAnimatedPoints(nextPoints);

      if (elapsed < chartMorphDurationMs) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        animatedPointsRef.current = targetPoints;
        setAnimatedPoints(targetPoints);
        frameRef.current = null;
      }
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [targetPoints]);

  return animatedPoints;
}

function volumeBins(candles: Candle[], plotWidth: number) {
  if (candles.length === 0) {
    return [];
  }

  const maxBars = Math.max(1, Math.floor(plotWidth / minVolumeSlotWidth));
  const binCount = Math.min(candles.length, maxBars);

  return Array.from({ length: binCount }, (_, binIndex) => {
    const startIndex = Math.floor((binIndex * candles.length) / binCount);
    const endIndex = Math.max(
      startIndex + 1,
      Math.floor(((binIndex + 1) * candles.length) / binCount),
    );
    const binCandles = candles.slice(startIndex, endIndex);
    const first = binCandles[0];
    const last = binCandles.at(-1)!;

    return {
      startIndex,
      endIndex,
      startTime: first.timestamp_ms,
      endTime: last.timestamp_ms,
      volume: binCandles.reduce((sum, candle) => sum + candle.volume, 0),
      rising: last.close >= first.open,
    };
  });
}

export function StockChart({
  candles,
  timeframe,
  visibleStartMs,
  visibleEndMs,
  mode,
  tone = "up",
  loading = false,
  onVisibleCandlesChange,
}: StockChartProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ start: 0, size: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragEndIndex, setDragEndIndex] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [measuredTooltipHeight, setMeasuredTooltipHeight] = useState(0);
  const measuredWidth = Math.floor(size.width);
  const measuredHeight = Math.floor(size.height);
  const width = Math.max(measuredWidth, 320);
  const height = Math.max(measuredHeight, 400);
  const minimumViewportSize = viewportMinimum(candles.length);
  const viewportSize =
    candles.length === 0
      ? 0
      : clamp(viewport.size || candles.length, minimumViewportSize, candles.length);
  const viewportStart = clamp(viewport.start, 0, Math.max(candles.length - viewportSize, 0));
  const visibleCandles = useMemo(
    () => candles.slice(viewportStart, viewportStart + viewportSize),
    [candles, viewportSize, viewportStart],
  );
  const canPan = viewportSize > 0 && viewportSize < candles.length;
  const canZoomIn = candles.length > minimumViewportSize && viewportSize > minimumViewportSize;
  const canZoomOut = viewportSize < candles.length;

  const chart = useMemo(() => {
    const plotWidth = Math.max(width - margin.left - margin.right, 240);
    const volumeHeight = clamp(height * 0.18, 76, 112);
    const volumeGap = 22;
    const plotHeight = height - margin.top - margin.bottom - volumeHeight - volumeGap;
    const volumeTop = margin.top + plotHeight + volumeGap;
    const lows = visibleCandles.map((candle) => (mode === "line" ? candle.close : candle.low));
    const highs = visibleCandles.map((candle) => (mode === "line" ? candle.close : candle.high));
    const minLow = lows.length ? Math.min(...lows) : 0;
    const maxHigh = highs.length ? Math.max(...highs) : 1;
    const pricePadding = Math.max((maxHigh - minLow) * 0.06, maxHigh * 0.002, 1);
    const priceMin = minLow - pricePadding;
    const priceMax = maxHigh + pricePadding;
    const priceRange = priceMax - priceMin || 1;
    const step = plotWidth / Math.max(visibleCandles.length - 1, 1);
    const candleWidth = clamp(step * 0.58, 2, 11);
    const priceToY = (price: number) =>
      margin.top + ((priceMax - price) / priceRange) * plotHeight;

    const points = visibleCandles.map((candle, index) => {
      return {
        candle,
        x: margin.left + index * step,
        openY: priceToY(candle.open),
        highY: priceToY(candle.high),
        lowY: priceToY(candle.low),
        closeY: priceToY(candle.close),
        rising: candle.close >= candle.open,
      };
    });
    const bins = volumeBins(visibleCandles, plotWidth);
    const maxVolume = Math.max(...bins.map((bin) => bin.volume), 1);
    const volumeStep = plotWidth / Math.max(bins.length - 1, 1);
    const volumeBarWidth = clamp(volumeStep * 0.64, 1.25, 8);
    const volumeBars: VolumeBar[] = bins.map((bin) => {
      const volumeBarHeight = (bin.volume / maxVolume) * volumeHeight;
      const x =
        bins.length === visibleCandles.length
          ? margin.left + bin.startIndex * step
          : margin.left + ((bin.startIndex + bin.endIndex - 1) / 2) * step;

      return {
        key: `${bin.startTime}-${bin.endTime}`,
        x,
        y: volumeTop + volumeHeight - volumeBarHeight,
        width: volumeBarWidth,
        height: volumeBarHeight,
        rising: bin.rising,
      };
    });

    return {
      points,
      volumeBars,
      plotWidth,
      plotHeight,
      volumeHeight,
      volumeTop,
      candleWidth,
      priceMin,
      priceMax,
      step,
    };
  }, [height, mode, visibleCandles, width]);

  const animatedPoints = useAnimatedChartPoints(chart.points);
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
  const measurement =
    isDragging && selectionStartIndex != null && selectionEndIndex != null
      ? {
          start: chart.points[selectionStartIndex],
          end: chart.points[selectionEndIndex],
          change: selectionChange,
          percent:
            (selectionChange / chart.points[selectionStartIndex].candle.close) *
            100,
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
  const tooltipY = margin.top - tooltipHeight - tooltipGap;

  useEffect(() => {
    panDragRef.current = null;
    setViewport(viewportForWindow(candles, visibleStartMs, visibleEndMs));
    setHoverIndex(null);
    setDragStartIndex(null);
    setDragEndIndex(null);
    setIsPanning(false);
  }, [candles, timeframe, visibleEndMs, visibleStartMs]);

  useEffect(() => {
    onVisibleCandlesChange?.(visibleCandles);
  }, [onVisibleCandlesChange, visibleCandles]);

  useLayoutEffect(() => {
    const nextHeight = Math.ceil(tooltipRef.current?.getBoundingClientRect().height ?? 0);

    setMeasuredTooltipHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, [activePoint, measurement, tooltipWidth]);

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    if (candles.length === 0) {
      return;
    }

    const horizontalPan = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (horizontalPan && canPan) {
      event.preventDefault();
      const candleDelta = Math.round(event.deltaX / Math.max(chart.step, 1));
      const nextStart = clamp(
        viewportStart + candleDelta,
        0,
        Math.max(candles.length - viewportSize, 0),
      );

      setViewport((currentViewport) =>
        currentViewport.start === nextStart
          ? currentViewport
          : { ...currentViewport, start: nextStart },
      );
      return;
    }

    if ((event.deltaY < 0 && !canZoomIn) || (event.deltaY > 0 && !canZoomOut) || event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = clamp(event.clientX - rect.left, margin.left, margin.left + chart.plotWidth);
    const pointerRatio = clamp((pointerX - margin.left) / chart.plotWidth, 0, 1);

    setViewport((currentViewport) => {
      const currentSize = clamp(
        currentViewport.size || candles.length,
        minimumViewportSize,
        candles.length,
      );
      const currentStart = clamp(
        currentViewport.start,
        0,
        Math.max(candles.length - currentSize, 0),
      );
      const nextSize = clamp(
        Math.round(currentSize * Math.exp(event.deltaY * wheelZoomSensitivity)),
        minimumViewportSize,
        candles.length,
      );
      const anchor = currentStart + pointerRatio * currentSize;
      const nextStart = clamp(
        Math.round(anchor - pointerRatio * nextSize),
        0,
        Math.max(candles.length - nextSize, 0),
      );

      return { start: nextStart, size: nextSize };
    });

    panDragRef.current = null;
    setHoverIndex(null);
    setDragStartIndex(null);
    setDragEndIndex(null);
    setIsPanning(false);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (chart.points.length === 0) {
      return;
    }

    const panDrag = panDragRef.current;
    if (panDrag && canPan) {
      const candleDelta = Math.round((panDrag.clientX - event.clientX) / Math.max(chart.step, 1));
      const nextStart = clamp(
        panDrag.start + candleDelta,
        0,
        Math.max(candles.length - viewportSize, 0),
      );

      setViewport((currentViewport) =>
        currentViewport.start === nextStart
          ? currentViewport
          : { ...currentViewport, start: nextStart },
      );
      setHoverIndex(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, margin.left, margin.left + chart.plotWidth);
    const index = nearestIndex(x, chart.points);

    setHoverIndex(index);
    if (dragStartIndex != null) {
      setDragEndIndex(index);
    }
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (chart.points.length === 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, margin.left, margin.left + chart.plotWidth);
    const index = nearestIndex(x, chart.points);

    event.currentTarget.setPointerCapture(event.pointerId);
    if (canPan) {
      panDragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        start: viewportStart,
      };
      setIsPanning(true);
      setHoverIndex(null);
      setDragStartIndex(null);
      setDragEndIndex(null);
      return;
    }

    setDragStartIndex(index);
    setDragEndIndex(index);
    setHoverIndex(index);
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null;
    }

    setIsPanning(false);
    setDragStartIndex(null);
    setDragEndIndex(null);
  }

  function handlePointerCancel(event: React.PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null;
    }

    setIsPanning(false);
    setDragStartIndex(null);
    setDragEndIndex(null);
  }

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
        className="h-full w-full touch-none overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${mode === "line" ? "Line" : "Candlestick"} chart with volume`}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        onPointerLeave={() => {
          if (!isPanning) {
            setHoverIndex(null);
          }
        }}
        style={{
          cursor: isPanning ? "grabbing" : canPan ? "grab" : "crosshair",
          display: measuredWidth === 0 ? "none" : undefined,
        }}
      >
        <rect width={width} height={height} rx="6" fill="var(--card)" />

        {priceTicks(chart.priceMin, chart.priceMax).map((tick) => {
          const y =
            margin.top +
            ((chart.priceMax - tick) / (chart.priceMax - chart.priceMin || 1)) * chart.plotHeight;

          return (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + chart.plotWidth}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 5"
              />
              <text
                x={width - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {formatCurrency(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={margin.left}
          x2={margin.left + chart.plotWidth}
          y1={chart.volumeTop}
          y2={chart.volumeTop}
          stroke="var(--border)"
        />

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
          </g>
        ) : (
          <g>
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

        {xTicks(chart.points).map((point, tickIndex, ticks) => {
          const isFirstTick = tickIndex === 0;
          const isLastTick = tickIndex === ticks.length - 1;

          return (
            <text
              key={point.candle.timestamp_ms}
              x={isFirstTick ? margin.left : isLastTick ? margin.left + chart.plotWidth : point.x}
              y={height - 10}
              textAnchor={isFirstTick ? "start" : isLastTick ? "end" : "middle"}
              className="fill-muted-foreground text-[11px]"
            >
              {formatDate(point.candle.timestamp_ms, timeframe)}
            </text>
          );
        })}

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
              x2={margin.left + chart.plotWidth}
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

      </svg>

      {activePoint ? (
        <div
          ref={tooltipRef}
          className="bg-popover text-popover-foreground pointer-events-none absolute rounded-md border px-3 py-2 text-[11px] shadow-md transition-[left,top,width] duration-200 ease-out"
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
      ) : null}
    </div>
  );
}
