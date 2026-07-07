import type { Candle } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CandleData } from "@/hooks/chart-workspace-state";
import type { ChartTone } from "@/components/stock-chart";

// Stable empty fallback: a fresh [] each render would retrigger the chart's
// candles/signals effects and loop setState before any data has loaded.
const noCandles: Candle[] = [];

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export interface ChartDisplayWindow extends TimeWindow {
  ticker: string;
  timeframe: string;
}

interface ChartDisplayInput {
  candleData: CandleData | null;
  candleWindow: TimeWindow | undefined;
  candleRequestWindow: TimeWindow | undefined;
  selectedTicker: string;
  timeframe: string;
  /** Last fully-loaded display; keeps stale candles on screen during a timeframe switch. */
  lastDisplay: ChartDisplayWindow | null;
}

/**
 * Decides which candles the chart should show right now: the freshly loaded
 * window, or — while a new timeframe is still loading — the previous window
 * of the same ticker so the chart doesn't flash empty.
 */
export function chartDisplay({
  candleData,
  candleWindow,
  candleRequestWindow,
  selectedTicker,
  timeframe,
  lastDisplay,
}: ChartDisplayInput) {
  const candleDataCurrent =
    candleData != null &&
    candleRequestWindow != null &&
    candleData.ticker === selectedTicker &&
    candleData.timeframe === timeframe &&
    candleData.startMs === candleRequestWindow.startMs &&
    candleData.endMs === candleRequestWindow.endMs;
  const canShowPendingTimeframeCandles =
    candleData != null && candleData.ticker === selectedTicker && !candleDataCurrent;
  const staleChartDisplay =
    canShowPendingTimeframeCandles && lastDisplay?.ticker === selectedTicker ? lastDisplay : null;
  const chartCandles =
    candleDataCurrent || canShowPendingTimeframeCandles
      ? candleData?.candles ?? noCandles
      : noCandles;
  const chartTimeframe = candleDataCurrent
    ? timeframe
    : canShowPendingTimeframeCandles
      ? staleChartDisplay?.timeframe ?? candleData?.timeframe ?? timeframe
      : timeframe;
  const chartCandleWindow =
    candleDataCurrent && candleWindow
      ? candleWindow
      : staleChartDisplay
        ? { startMs: staleChartDisplay.startMs, endMs: staleChartDisplay.endMs }
        : undefined;

  return { candleDataCurrent, chartCandles, chartTimeframe, chartCandleWindow };
}

/** Price change, tone, and legend values for the candles currently in view. */
export function priceSummary(
  visibleCandles: Candle[],
  chartCandles: Candle[],
  timeframe: string,
  candleWindow: TimeWindow | undefined,
  hoverCandle: Candle | null,
) {
  const summaryCandles =
    visibleCandles.length > 0 && chartCandles.length > 0 ? visibleCandles : chartCandles;
  const latest = summaryCandles.at(-1);
  const first = summaryCandles.at(0);
  const rangeChange = latest && first ? latest.close - first.close : 0;
  const rangePercent = latest && first ? (rangeChange / first.close) * 100 : 0;
  const chartTone: ChartTone = rangeChange < 0 ? "down" : "up";
  const hasPriceSummary = Boolean(latest && first);
  const visibleWindowLabel =
    visibleCandles.length > 0
      ? `${formatDate(visibleCandles[0].timestamp_ms, timeframe)} - ${formatDate(visibleCandles.at(-1)!.timestamp_ms, timeframe)}`
      : candleWindow
        ? `${formatDate(candleWindow.startMs, timeframe)} - ${formatDate(candleWindow.endMs, timeframe)}`
        : null;
  // Legend values track the hovered candle; without a hover they show the
  // newest candle in view.
  const legendTimestampMs = (hoverCandle ?? summaryCandles.at(-1))?.timestamp_ms ?? null;

  return {
    latest,
    rangeChange,
    rangePercent,
    chartTone,
    hasPriceSummary,
    visibleWindowLabel,
    legendTimestampMs,
  };
}
