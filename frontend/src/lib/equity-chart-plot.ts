import type { BacktestEquityPoint, BacktestTrade } from "@/lib/api";
import type { EquityOverlay } from "@/components/equity-chart-types";
import { formatDate } from "@/lib/format";

export const equityChartMargin = { top: 12, right: 64, bottom: 26, left: 10 };

const maxTradeMarkers = 60;

function niceTicks(min: number, max: number, count = 4) {
  if (!(max > min)) {
    return [min];
  }
  const step = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= step) ?? step;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / niceStep) * niceStep; tick <= max + niceStep / 1e6; tick += niceStep) {
    ticks.push(tick);
  }
  return ticks;
}

export function buildEquityChartPlot({
  points,
  trades,
  initialCapital,
  timeframe,
  overlays,
  width,
  height,
}: {
  points: BacktestEquityPoint[];
  trades: BacktestTrade[];
  initialCapital: number;
  timeframe: string;
  overlays: EquityOverlay[];
  width: number;
  height: number;
}) {
  if (points.length === 0 || width <= 0) {
    return null;
  }

  const innerWidth = Math.max(width - equityChartMargin.left - equityChartMargin.right, 10);
  const innerHeight = height - equityChartMargin.top - equityChartMargin.bottom;
  const indexByTimestamp = new Map(points.map((point, index) => [point.timestamp_ms, index]));

  // Comparison points that don't share a bar with the equity curve (e.g. a
  // different trading calendar) are dropped rather than interpolated.
  const overlayPlots = overlays.map((overlay) => ({
    overlay,
    matched: overlay.points.flatMap((point) => {
      const index = indexByTimestamp.get(point.timestamp_ms);
      return index == null ? [] : [{ index, value: point.value }];
    }),
  }));

  let min = Math.min(...points.map((point) => point.equity), initialCapital);
  let max = Math.max(...points.map((point) => point.equity), initialCapital);
  for (const { matched } of overlayPlots) {
    for (const point of matched) {
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
  }
  const pad = (max - min || max || 1) * 0.08;
  const domainMin = min - pad;
  const domainMax = max + pad;

  const xAt = (index: number) =>
    equityChartMargin.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yAt = (value: number) =>
    equityChartMargin.top + ((domainMax - value) / (domainMax - domainMin)) * innerHeight;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(point.equity).toFixed(2)}`)
    .join("");
  const baselineY = yAt(initialCapital);
  const areaPath = `${linePath}L${xAt(points.length - 1).toFixed(2)},${baselineY.toFixed(2)}L${xAt(0).toFixed(2)},${baselineY.toFixed(2)}Z`;

  const overlayPaths = overlayPlots
    .filter(({ matched }) => matched.length > 1)
    .map(({ overlay, matched }) => ({
      overlay,
      path: matched
        .map((point, order) => `${order === 0 ? "M" : "L"}${xAt(point.index).toFixed(2)},${yAt(point.value).toFixed(2)}`)
        .join(""),
      valueByIndex: new Map(matched.map((point) => [point.index, point.value])),
    }));

  const markers =
    trades.length > maxTradeMarkers
      ? []
      : trades.flatMap((trade) => {
          const index = indexByTimestamp.get(trade.timestamp_ms);
          if (index == null) {
            return [];
          }
          return [{ trade, x: xAt(index), y: yAt(points[index].equity) }];
        });

  const tickCountX = Math.max(2, Math.min(6, Math.floor(innerWidth / 130)));
  const xTicks = Array.from({ length: tickCountX }, (_, tick) => {
    const index = Math.round((tick / (tickCountX - 1)) * (points.length - 1));
    return { x: xAt(index), label: formatDate(points[index].timestamp_ms, timeframe) };
  });

  return {
    innerWidth,
    xAt,
    yAt,
    linePath,
    areaPath,
    baselineY,
    overlayPaths,
    markers,
    xTicks,
    yTicks: niceTicks(domainMin, domainMax).map((value) => ({ y: yAt(value), value })),
  };
}
