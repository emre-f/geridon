import type { Candle, IndicatorSeries, StrategySignal } from "@/lib/api";
import {
  clamp,
  margin,
  signalMarkerSize,
  type ChartMode,
  type ChartPoint,
  type SignalMarker,
} from "@/components/stock-chart/chart-types";
import { finiteValue, sparseLinePaths } from "@/components/stock-chart/chart-geometry";
import {
  indicatorLineVisual,
  type IndicatorValueMaps,
} from "@/components/stock-chart/indicator-visuals";
import { buildIndicatorPanes } from "@/components/stock-chart/build-chart-panes";
import { buildVolumeSection } from "@/components/stock-chart/build-chart-volume";

interface ChartLayoutInput {
  width: number;
  height: number;
  mode: ChartMode;
  visibleCandles: Candle[];
  indicators: IndicatorSeries[];
  indicatorMaps: IndicatorValueMaps;
  signalsByTimestamp: Map<number, StrategySignal[]>;
}

export type ChartLayout = ReturnType<typeof buildChartLayout>;

/** Converts the visible candles + indicator series into pixel-space geometry for the SVG. */
export function buildChartLayout({
  width,
  height,
  mode,
  visibleCandles,
  indicators,
  indicatorMaps,
  signalsByTimestamp,
}: ChartLayoutInput) {
  const plotWidth = Math.max(width - margin.left - margin.right, 240);
  const volumeHeight = clamp(height * 0.15, 64, 102);
  const volumeGap = 22;
  const paneGap = 14;
  const paneIndicators = indicators.filter((indicator) => indicator.placement === "pane");
  const overlayIndicators = indicators.filter((indicator) => indicator.placement === "overlay");
  const paneCount = paneIndicators.length;
  const availableHeight = height - margin.top - margin.bottom - volumeHeight - volumeGap;
  const paneGapTotal = paneCount * paneGap;
  const paneHeight =
    paneCount === 0
      ? 0
      : Math.min(78, Math.max(18, (availableHeight - 130 - paneGapTotal) / paneCount));
  const paneTotalHeight = paneCount === 0 ? 0 : paneCount * paneHeight + paneGapTotal;
  const plotHeight = Math.max(120, availableHeight - paneTotalHeight);
  const volumeTop = margin.top + plotHeight + paneTotalHeight + volumeGap;
  const overlayNumbers: number[] = [];

  for (const candle of visibleCandles) {
    for (const indicator of overlayIndicators) {
      const values = indicatorMaps.get(indicator.id)?.get(candle.timestamp_ms);
      if (!values) {
        continue;
      }

      for (const valueDefinition of indicator.values) {
        const value = values[valueDefinition.key];
        if (finiteValue(value)) {
          overlayNumbers.push(value);
        }
      }
    }
  }

  const lows = visibleCandles.map((candle) => (mode === "line" ? candle.close : candle.low));
  const highs = visibleCandles.map((candle) => (mode === "line" ? candle.close : candle.high));
  const minLow = lows.length || overlayNumbers.length ? Math.min(...lows, ...overlayNumbers) : 0;
  const maxHigh = highs.length || overlayNumbers.length ? Math.max(...highs, ...overlayNumbers) : 1;
  const pricePadding = Math.max((maxHigh - minLow) * 0.06, maxHigh * 0.002, 1);
  const priceMin = minLow - pricePadding;
  const priceMax = maxHigh + pricePadding;
  const priceRange = priceMax - priceMin || 1;
  const step = plotWidth / Math.max(visibleCandles.length - 1, 1);
  const candleWidth = clamp(step * 0.58, 2, 11);
  const priceToY = (price: number) => margin.top + ((priceMax - price) / priceRange) * plotHeight;

  const points: ChartPoint[] = visibleCandles.map((candle, index) => ({
    candle,
    x: margin.left + index * step,
    openY: priceToY(candle.open),
    highY: priceToY(candle.high),
    lowY: priceToY(candle.low),
    closeY: priceToY(candle.close),
    rising: candle.close >= candle.open,
  }));
  const signalMarkers: SignalMarker[] = points.flatMap((point) => {
    const pointSignals = signalsByTimestamp.get(point.candle.timestamp_ms) ?? [];
    return pointSignals.map((signal, signalIndex) => {
      const offset = signalIndex * (signalMarkerSize + 2);
      const y =
        signal.side === "buy"
          ? clamp(
              point.lowY + 12 + offset,
              margin.top + signalMarkerSize,
              margin.top + plotHeight - signalMarkerSize,
            )
          : clamp(
              point.highY - 12 - offset,
              margin.top + signalMarkerSize,
              margin.top + plotHeight - signalMarkerSize,
            );
      // Buy: upward triangle below the bar. Sell: downward triangle above.
      // Cash: diamond above, so a flatten never reads as a short/sell.
      const markerPoints =
        signal.side === "buy"
          ? `${point.x},${y - signalMarkerSize} ${point.x - signalMarkerSize},${y + signalMarkerSize} ${point.x + signalMarkerSize},${y + signalMarkerSize}`
          : signal.side === "sell"
            ? `${point.x},${y + signalMarkerSize} ${point.x - signalMarkerSize},${y - signalMarkerSize} ${point.x + signalMarkerSize},${y - signalMarkerSize}`
            : `${point.x},${y - signalMarkerSize} ${point.x + signalMarkerSize},${y} ${point.x},${y + signalMarkerSize} ${point.x - signalMarkerSize},${y}`;

      return {
        key: `${signal.side}-${point.candle.timestamp_ms}-${signalIndex}`,
        side: signal.side,
        points: markerPoints,
      };
    });
  });
  const indicatorOrder = new Map(indicators.map((indicator, index) => [indicator.id, index]));
  const overlayLines = overlayIndicators.flatMap((indicator, overlayIndex) => {
    const valueMap = indicatorMaps.get(indicator.id);
    const colorIndex = indicatorOrder.get(indicator.id) ?? overlayIndex;

    // Single pass: only "line"-styled values produce an overlay line.
    return indicator.values.flatMap((valueDefinition, valueIndex) => {
      if (valueDefinition.style !== "line") {
        return [];
      }

      const sparsePoints = visibleCandles.map((candle, candleIndex) => {
        const value = valueMap?.get(candle.timestamp_ms)?.[valueDefinition.key];
        return finiteValue(value)
          ? {
              x: margin.left + candleIndex * step,
              y: priceToY(value),
            }
          : null;
      });

      return [
        {
          key: `${indicator.id}-${valueDefinition.key}`,
          label: `${indicator.label} ${valueDefinition.label}`,
          ...indicatorLineVisual(indicator, colorIndex, valueIndex, 1.7, 0.95),
          paths: sparseLinePaths(sparsePoints),
        },
      ];
    });
  });
  const panes = buildIndicatorPanes({
    paneIndicators,
    indicatorMaps,
    indicatorOrder,
    visibleCandles,
    plotHeight,
    paneGap,
    paneHeight,
    step,
  });
  const { volumeBars, volumeLines } = buildVolumeSection({
    visibleCandles,
    volumeIndicators: indicators.filter((indicator) => indicator.placement === "volume"),
    indicatorMaps,
    indicatorOrder,
    plotWidth,
    volumeTop,
    volumeHeight,
    step,
  });

  return {
    points,
    signalMarkers,
    overlayLines,
    panes,
    volumeBars,
    volumeLines,
    plotWidth,
    plotHeight,
    volumeHeight,
    volumeTop,
    candleWidth,
    priceMin,
    priceMax,
    step,
  };
}
