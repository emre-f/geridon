import type { IndicatorSeries } from "@/lib/api";
import { strokeDashArray } from "@/lib/indicator-style";
import { indicatorPalette } from "@/components/stock-chart/chart-types";

export function customIndicatorColor(indicator: IndicatorSeries, valueIndex: number) {
  const color = indicator.styles?.[valueIndex]?.color;
  return color && color.trim() ? color : undefined;
}

function indicatorColor(indicator: IndicatorSeries, indicatorIndex: number, valueIndex: number) {
  const color = customIndicatorColor(indicator, valueIndex);
  if (color) {
    return color;
  }

  return indicatorPalette[(indicatorIndex + valueIndex) % indicatorPalette.length];
}

export function indicatorLineVisual(
  indicator: IndicatorSeries,
  indicatorIndex: number,
  valueIndex: number,
  fallbackWidth: number,
  fallbackOpacity: number,
) {
  const style = indicator.styles?.[valueIndex];

  return {
    color: indicatorColor(indicator, indicatorIndex, valueIndex),
    width: style?.width ?? fallbackWidth,
    opacity: style?.opacity ?? fallbackOpacity,
    dashArray: style ? strokeDashArray(style.stroke, style.width) : undefined,
  };
}

// Hoisted: constructing Intl.NumberFormat per call is expensive in render loops.
const preciseNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const roundedNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatIndicatorNumber(value: number) {
  return (Math.abs(value) < 10 ? preciseNumberFormat : roundedNumberFormat).format(value);
}

export function indicatorValueMaps(indicators: IndicatorSeries[]) {
  return new Map(
    indicators.map((indicator) => [
      indicator.id,
      new Map(indicator.points.map((point) => [point.timestamp_ms, point.values])),
    ]),
  );
}

export type IndicatorValueMaps = ReturnType<typeof indicatorValueMaps>;
