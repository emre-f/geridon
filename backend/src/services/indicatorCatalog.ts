import type {
  IndicatorDefinition,
  IndicatorKind,
  IndicatorPointResponse,
} from "../types.ts";
import {
  computeAtr,
  computeBollinger,
  computeEma,
  computeMacd,
  computeRsi,
  computeRvol,
  computeSma,
  type IndicatorCandle,
} from "./indicatorCalculations.ts";

/**
 * A catalog entry plus its runtime behavior. Adding an indicator means
 * appending one implementation here: the API catalog, spec validation, the
 * strategy builder, and chart rendering are all driven by this list.
 */
export interface IndicatorImplementation extends IndicatorDefinition {
  compute: (
    candles: IndicatorCandle[],
    parameters: Record<string, number>,
  ) => IndicatorPointResponse[];
  /** Cross-parameter constraint check; returns an error message or null. */
  validateParameters?: (parameters: Record<string, number>) => string | null;
}

export const indicatorImplementations: IndicatorImplementation[] = [
  {
    kind: "sma",
    label: "SMA",
    full_name: "Simple Moving Average",
    description:
      "Average closing price over the last N bars. Smooths out noise to show the underlying trend.",
    placement: "overlay",
    parameters: [{ key: "period", label: "Period", default_value: 20, min: 1, max: 500, step: 1 }],
    values: [{ key: "sma", label: "SMA", style: "line" }],
    compute: (candles, parameters) => computeSma(candles, parameters.period),
  },
  {
    kind: "ema",
    label: "EMA",
    full_name: "Exponential Moving Average",
    description:
      "Moving average that weights recent bars more heavily, so it reacts to price changes faster than an SMA.",
    placement: "overlay",
    parameters: [{ key: "period", label: "Period", default_value: 20, min: 1, max: 500, step: 1 }],
    values: [{ key: "ema", label: "EMA", style: "line" }],
    compute: (candles, parameters) => computeEma(candles, parameters.period),
  },
  {
    kind: "rsi",
    label: "RSI",
    full_name: "Relative Strength Index",
    description:
      "Momentum oscillator from 0 to 100. Readings above 70 are often seen as overbought, below 30 as oversold.",
    placement: "pane",
    parameters: [{ key: "period", label: "Period", default_value: 14, min: 1, max: 500, step: 1 }],
    values: [{ key: "rsi", label: "RSI", style: "line" }],
    compute: (candles, parameters) => computeRsi(candles, parameters.period),
  },
  {
    kind: "macd",
    label: "MACD",
    full_name: "Moving Average Convergence Divergence",
    description:
      "Fast EMA minus slow EMA, with a signal line and histogram. Highlights shifts in trend direction and momentum.",
    placement: "pane",
    parameters: [
      { key: "fast", label: "Fast", default_value: 12, min: 1, max: 500, step: 1 },
      { key: "slow", label: "Slow", default_value: 26, min: 2, max: 500, step: 1 },
      { key: "signal", label: "Signal", default_value: 9, min: 1, max: 500, step: 1 },
    ],
    values: [
      {
        key: "macd",
        label: "MACD",
        description: "Fast EMA minus slow EMA, in price units. Positive when short-term momentum is up.",
        style: "line",
      },
      {
        key: "signal",
        label: "Signal",
        description: "EMA of the MACD line. Crosses with MACD are classic entry/exit signals.",
        style: "line",
      },
      {
        key: "histogram",
        label: "Hist",
        description: "MACD minus Signal. Oscillates around zero; grows as momentum builds.",
        style: "histogram",
      },
    ],
    compute: (candles, parameters) => computeMacd(candles, parameters),
    validateParameters: (parameters) =>
      parameters.fast >= parameters.slow ? "macd.fast must be less than macd.slow." : null,
  },
  {
    kind: "bollinger",
    label: "BB",
    full_name: "Bollinger Bands",
    description:
      "Moving average with bands N standard deviations above and below. Bands widen with volatility; price near a band can signal a stretch.",
    placement: "overlay",
    parameters: [
      { key: "period", label: "Period", default_value: 20, min: 1, max: 500, step: 1 },
      { key: "stdDev", label: "Std dev", default_value: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    values: [
      {
        key: "upper",
        label: "Upper",
        description: "Middle band plus N standard deviations, in price units.",
        style: "line",
      },
      {
        key: "middle",
        label: "Middle",
        description: "Simple moving average of close, in price units.",
        style: "line",
      },
      {
        key: "lower",
        label: "Lower",
        description: "Middle band minus N standard deviations, in price units.",
        style: "line",
      },
    ],
    compute: (candles, parameters) =>
      computeBollinger(candles, parameters.period, parameters.stdDev),
  },
  {
    kind: "rvol",
    label: "RVOL",
    full_name: "Relative Volume",
    description:
      "Volume divided by the average volume of the prior N bars. 1 is a typical bar, 2 means twice the usual activity. Draws the average as a line over the volume bars.",
    placement: "volume",
    parameters: [{ key: "period", label: "Period", default_value: 20, min: 1, max: 500, step: 1 }],
    values: [
      {
        key: "rvol",
        label: "RVOL",
        description: "Volume divided by average volume. A ratio near 1; 2 means twice the usual activity.",
        style: "none",
      },
      {
        key: "average",
        label: "Avg Vol",
        description: "Average volume of the prior N bars, in shares. Drawn as the line over the volume bars.",
        style: "line",
      },
    ],
    compute: (candles, parameters) => computeRvol(candles, parameters.period),
  },
  {
    kind: "atr",
    label: "ATR",
    full_name: "Average True Range",
    description:
      "Average size of each bar's true range over N periods. Measures how much price moves, not which direction.",
    placement: "pane",
    parameters: [{ key: "period", label: "Period", default_value: 14, min: 1, max: 500, step: 1 }],
    values: [{ key: "atr", label: "ATR", style: "line" }],
    compute: (candles, parameters) => computeAtr(candles, parameters.period),
  },
];

export const indicatorCatalog: IndicatorDefinition[] = indicatorImplementations.map(
  ({ compute, validateParameters, ...definition }) => definition,
);

export const catalogByKind = new Map<IndicatorKind, IndicatorImplementation>(
  indicatorImplementations.map((implementation) => [implementation.kind, implementation]),
);
