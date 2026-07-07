import type { Candle } from "@/lib/api";
import {
  clamp,
  minVisibleCandles,
  minVolumeSlotWidth,
  type ChartPoint,
  type SparsePoint,
} from "@/components/stock-chart/chart-types";

export function viewportMinimum(totalCandles: number) {
  return Math.min(totalCandles, minVisibleCandles);
}

export function viewportForWindow(
  candles: Candle[],
  startMs: number | undefined,
  endMs: number | undefined,
) {
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

export function nearestIndex(x: number, points: ChartPoint[]) {
  if (points.length <= 1) {
    return 0;
  }

  const firstX = points[0].x;
  const step = points[1].x - firstX;
  return clamp(Math.round((x - firstX) / step), 0, points.length - 1);
}

export function priceTicks(min: number, max: number) {
  const ticks: number[] = [];
  const count = 5;

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    ticks.push(max - (max - min) * ratio);
  }

  return ticks;
}

export function xTicks(points: ChartPoint[]) {
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

export function linePath(points: ChartPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.closeY}`)
    .join(" ");
}

export function areaPath(points: ChartPoint[], baseline: number) {
  if (points.length === 0) {
    return "";
  }

  return `${linePath(points)} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

export function sparseLinePaths(points: Array<SparsePoint | null>) {
  const paths: string[] = [];
  let commands: string[] = [];

  function flush() {
    if (commands.length > 1) {
      paths.push(commands.join(" "));
    }
    commands = [];
  }

  for (const point of points) {
    if (!point) {
      flush();
      continue;
    }

    commands.push(`${commands.length === 0 ? "M" : "L"} ${point.x} ${point.y}`);
  }

  flush();
  return paths;
}

export function finiteValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function volumeBins(candles: Candle[], plotWidth: number) {
  if (candles.length === 0) {
    return [];
  }

  const maxBars = Math.max(1, Math.floor(plotWidth / minVolumeSlotWidth));
  // Fixed-size bins: proportional slicing yields alternating bin sizes (e.g.
  // 2,2,3 repeating), and since indicator lines scale by bin size that renders
  // as a periodic sawtooth. Only the final bin may be smaller.
  const binSize = Math.max(1, Math.ceil(candles.length / maxBars));
  const binCount = Math.ceil(candles.length / binSize);

  return Array.from({ length: binCount }, (_, binIndex) => {
    const startIndex = binIndex * binSize;
    const endIndex = Math.min(candles.length, startIndex + binSize);
    const binCandles = candles.slice(startIndex, endIndex);
    const first = binCandles[0];
    const last = binCandles.at(-1)!;

    return {
      startIndex,
      endIndex,
      startTime: first.timestamp_ms,
      endTime: last.timestamp_ms,
      // Average per candle rather than sum: the final bin is often partial,
      // and a summed bar (plus a line scaled by candle count) would collapse
      // at the right edge of the chart.
      volume:
        binCandles.reduce((sum, candle) => sum + candle.volume, 0) / binCandles.length,
      rising: last.close >= first.open,
    };
  });
}
