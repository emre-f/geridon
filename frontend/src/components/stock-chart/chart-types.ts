import type { Candle, IndicatorSeries, StrategySignal } from "@/lib/api";

export type ChartMode = "line" | "candle";
export type ChartTone = "up" | "down";

export interface ChartPoint {
  candle: Candle;
  x: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  rising: boolean;
}

export interface VolumeBar {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rising: boolean;
}

export interface SparsePoint {
  x: number;
  y: number;
}

export interface IndicatorLine {
  key: string;
  label: string;
  color: string;
  width: number;
  opacity: number;
  dashArray?: string;
  paths: string[];
}

export interface IndicatorHistogramBar {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export interface SignalMarker {
  key: string;
  side: StrategySignal["side"];
  points: string;
}

export interface IndicatorPaneChart {
  id: string;
  label: string;
  kind: IndicatorSeries["kind"];
  top: number;
  height: number;
  ticks: number[];
  lines: IndicatorLine[];
  histogramBars: IndicatorHistogramBar[];
  guides: number[];
  valueToY: (value: number) => number;
}

export interface Viewport {
  start: number;
  size: number;
}

export interface PanDrag {
  pointerId: number;
  clientX: number;
  start: number;
}

export const tooltipGap = 10;
export const hoverTooltipHeightEstimate = 118;
export const measurementTooltipHeightEstimate = 54;
export const hoverTooltipWidth = 240;
export const measurementTooltipWidth = 220;
export const minVolumeSlotWidth = 3;
export const minVisibleCandles = 18;
export const wheelZoomSensitivity = 0.0015;
export const selectionGuideStroke = "var(--muted-foreground)";
export const selectionGuideOpacity = 0.5;
export const markerRadius = 4.5;
export const markerStrokeWidth = 2;
export const signalMarkerSize = 6;
export const chartFrameClass = "h-[clamp(500px,calc(100vh-16rem),720px)] w-full";
export const chartMorphDurationMs = 320;
export const indicatorPalette = [
  "var(--indicator-1)",
  "var(--indicator-2)",
  "var(--indicator-3)",
  "var(--indicator-4)",
  "var(--indicator-5)",
  "var(--indicator-6)",
];
export const margin = {
  top: 72,
  right: 76,
  bottom: 34,
  left: 10,
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
