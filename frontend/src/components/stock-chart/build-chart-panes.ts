import type { Candle, IndicatorSeries } from "@/lib/api";
import {
  clamp,
  margin,
  type IndicatorPaneChart,
} from "@/components/stock-chart/chart-types";
import { finiteValue, sparseLinePaths } from "@/components/stock-chart/chart-geometry";
import {
  customIndicatorColor,
  indicatorLineVisual,
  type IndicatorValueMaps,
} from "@/components/stock-chart/indicator-visuals";

interface PaneLayoutInput {
  paneIndicators: IndicatorSeries[];
  indicatorMaps: IndicatorValueMaps;
  indicatorOrder: Map<string, number>;
  visibleCandles: Candle[];
  plotHeight: number;
  paneGap: number;
  paneHeight: number;
  step: number;
}

/** Lays out the sub-panes (RSI, MACD, ATR, …) stacked under the price plot. */
export function buildIndicatorPanes({
  paneIndicators,
  indicatorMaps,
  indicatorOrder,
  visibleCandles,
  plotHeight,
  paneGap,
  paneHeight,
  step,
}: PaneLayoutInput): IndicatorPaneChart[] {
  return paneIndicators.map((indicator, paneIndex) => {
    const top = margin.top + plotHeight + paneGap + paneIndex * (paneHeight + paneGap);
    const valueMap = indicatorMaps.get(indicator.id);
    const numericValues = visibleCandles.flatMap((candle) => {
      const values = valueMap?.get(candle.timestamp_ms);
      if (!values) {
        return [];
      }

      return indicator.values.flatMap((valueDefinition) => {
        const value = values[valueDefinition.key];
        return finiteValue(value) ? [value] : [];
      });
    });
    const baseValues = indicator.kind === "macd" || indicator.kind === "atr" ? [0] : [];
    const scaleValues = numericValues.length > 0 ? [...numericValues, ...baseValues] : [0, 1];
    const rawMin = indicator.kind === "rsi" ? 0 : Math.min(...scaleValues);
    const rawMax = indicator.kind === "rsi" ? 100 : Math.max(...scaleValues);
    const padding =
      indicator.kind === "rsi"
        ? 0
        : Math.max((rawMax - rawMin) * 0.16, Math.max(Math.abs(rawMax), 1) * 0.04);
    const paneMin = rawMin === rawMax ? rawMin - 1 : rawMin - padding;
    const paneMax = rawMin === rawMax ? rawMax + 1 : rawMax + padding;
    const paneRange = paneMax - paneMin || 1;
    const valueToY = (value: number) => top + ((paneMax - value) / paneRange) * paneHeight;
    const colorIndex = indicatorOrder.get(indicator.id) ?? paneIndex;
    const histogramWidth = clamp(step * 0.52, 1.25, 8);
    const zeroY = valueToY(0);
    // Single pass: only "histogram"-styled values produce bars.
    const histogramBars = indicator.values.flatMap((valueDefinition, valueIndex) => {
      if (valueDefinition.style !== "histogram") {
        return [];
      }

      return visibleCandles.flatMap((candle, candleIndex) => {
          const value = valueMap?.get(candle.timestamp_ms)?.[valueDefinition.key];
          if (!finiteValue(value)) {
            return [];
          }

          const valueY = valueToY(value);
          const customColor = customIndicatorColor(indicator, valueIndex);
          return [
            {
              key: `${indicator.id}-${valueDefinition.key}-${candle.timestamp_ms}`,
              x: margin.left + candleIndex * step,
              y: Math.min(valueY, zeroY),
              width: histogramWidth,
              height: Math.max(Math.abs(zeroY - valueY), 1),
              color:
                customColor ?? (value >= 0 ? "var(--chart-up-muted)" : "var(--chart-down-muted)"),
              opacity: indicator.styles?.[valueIndex]?.opacity ?? 1,
            },
          ];
        });
    });
    // Single pass: only "line"-styled values produce a pane line.
    const lines = indicator.values.flatMap((valueDefinition, valueIndex) => {
      if (valueDefinition.style !== "line") {
        return [];
      }

      const sparsePoints = visibleCandles.map((candle, candleIndex) => {
        const value = valueMap?.get(candle.timestamp_ms)?.[valueDefinition.key];
        return finiteValue(value)
          ? {
              x: margin.left + candleIndex * step,
              y: valueToY(value),
            }
          : null;
      });

      return [
        {
          key: `${indicator.id}-${valueDefinition.key}`,
          label: `${indicator.label} ${valueDefinition.label}`,
          ...indicatorLineVisual(indicator, colorIndex, valueIndex, 1.5, 1),
          paths: sparseLinePaths(sparsePoints),
        },
      ];
    });
    const ticks =
      indicator.kind === "rsi"
        ? [70, 50, 30]
        : [paneMax, paneMin + (paneMax - paneMin) / 2, paneMin];

    return {
      id: indicator.id,
      label: indicator.label,
      kind: indicator.kind,
      top,
      height: paneHeight,
      ticks,
      lines,
      histogramBars,
      guides: indicator.kind === "rsi" ? [70, 30] : indicator.kind === "macd" ? [0] : [],
      valueToY,
    };
  });
}
