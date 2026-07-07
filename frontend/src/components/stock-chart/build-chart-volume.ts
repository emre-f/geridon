import type { Candle, IndicatorSeries } from "@/lib/api";
import {
  clamp,
  margin,
  type IndicatorLine,
  type VolumeBar,
} from "@/components/stock-chart/chart-types";
import { finiteValue, sparseLinePaths, volumeBins } from "@/components/stock-chart/chart-geometry";
import {
  indicatorLineVisual,
  type IndicatorValueMaps,
} from "@/components/stock-chart/indicator-visuals";

interface VolumeLayoutInput {
  visibleCandles: Candle[];
  volumeIndicators: IndicatorSeries[];
  indicatorMaps: IndicatorValueMaps;
  indicatorOrder: Map<string, number>;
  plotWidth: number;
  volumeTop: number;
  volumeHeight: number;
  step: number;
}

/** Lays out the volume bars and any volume-anchored indicator lines (e.g. volume SMA). */
export function buildVolumeSection({
  visibleCandles,
  volumeIndicators,
  indicatorMaps,
  indicatorOrder,
  plotWidth,
  volumeTop,
  volumeHeight,
  step,
}: VolumeLayoutInput) {
  const bins = volumeBins(visibleCandles, plotWidth);
  const binXs = bins.map((bin) =>
    bins.length === visibleCandles.length
      ? margin.left + bin.startIndex * step
      : margin.left + ((bin.startIndex + bin.endIndex - 1) / 2) * step,
  );
  const volumeLineSeries = volumeIndicators.flatMap((indicator, volumeIndex) => {
    const valueMap = indicatorMaps.get(indicator.id);
    const colorIndex = indicatorOrder.get(indicator.id) ?? volumeIndex;

    // Single pass: only "line"-styled values produce a volume line.
    return indicator.values.flatMap((valueDefinition, valueIndex) => {
      if (valueDefinition.style !== "line") {
        return [];
      }

      return [
        {
          key: `${indicator.id}-${valueDefinition.key}`,
          label: `${indicator.label} ${valueDefinition.label}`,
          visual: indicatorLineVisual(indicator, colorIndex, valueIndex, 1.5, 1),
          // Bars show average volume per candle in the bin, so the line can
          // plot per-candle values directly with no bin-size scaling.
          binValues: bins.map((bin) => {
            let binSum = 0;
            let binCount = 0;

            for (let candleIndex = bin.startIndex; candleIndex < bin.endIndex; candleIndex += 1) {
              const value = valueMap
                ?.get(visibleCandles[candleIndex].timestamp_ms)
                ?.[valueDefinition.key];
              if (finiteValue(value)) {
                binSum += value;
                binCount += 1;
              }
            }

            return binCount === 0 ? null : binSum / binCount;
          }),
        },
      ];
    });
  });
  const maxVolume = Math.max(
    ...bins.map((bin) => bin.volume),
    ...volumeLineSeries.flatMap((series) => series.binValues.filter(finiteValue)),
    1,
  );
  const volumeToY = (value: number) =>
    volumeTop + volumeHeight - (value / maxVolume) * volumeHeight;
  const volumeStep = plotWidth / Math.max(bins.length - 1, 1);
  const volumeBarWidth = clamp(volumeStep * 0.64, 1.25, 8);
  const volumeBars: VolumeBar[] = bins.map((bin, binIndex) => {
    const volumeBarHeight = (bin.volume / maxVolume) * volumeHeight;

    return {
      key: `${bin.startTime}-${bin.endTime}`,
      x: binXs[binIndex],
      y: volumeTop + volumeHeight - volumeBarHeight,
      width: volumeBarWidth,
      height: volumeBarHeight,
      rising: bin.rising,
    };
  });
  const volumeLines: IndicatorLine[] = volumeLineSeries.map((series) => ({
    key: series.key,
    label: series.label,
    ...series.visual,
    paths: sparseLinePaths(
      series.binValues.map((value, binIndex) =>
        value == null ? null : { x: binXs[binIndex], y: volumeToY(value) },
      ),
    ),
  }));

  return { volumeBars, volumeLines };
}
