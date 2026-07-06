import { toIsoUtc } from "../datetime.ts";
import type {
  CandleResponse,
  IndicatorDefinition,
  IndicatorKind,
  IndicatorPointResponse,
  IndicatorSeriesResponse,
  IndicatorSpec,
} from "../types.ts";

type IndicatorCandle = Pick<
  CandleResponse,
  "timestamp_ms" | "open" | "high" | "low" | "close" | "volume"
>;

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

const indicatorImplementations: IndicatorImplementation[] = [
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

const catalogByKind = new Map(
  indicatorImplementations.map((implementation) => [implementation.kind, implementation]),
);
const maxIndicatorSpecs = 12;

export function isIndicatorKind(value: string): value is IndicatorKind {
  return catalogByKind.has(value);
}

export function indicatorDefinition(kind: IndicatorKind): IndicatorDefinition {
  return catalogByKind.get(kind)!;
}

function normalizedParameter(
  kind: IndicatorKind,
  parameter: IndicatorDefinition["parameters"][number],
  rawValue: unknown,
) {
  const value = rawValue == null ? parameter.default_value : Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${kind}.${parameter.key} must be a finite number.`);
  }

  const normalized = parameter.step >= 1 ? Math.round(value) : value;
  if (normalized < parameter.min || normalized > parameter.max) {
    throw new Error(
      `${kind}.${parameter.key} must be between ${parameter.min} and ${parameter.max}.`,
    );
  }

  return normalized;
}

export function normalizeIndicatorParameters(
  kind: IndicatorKind,
  rawParameters: Record<string, unknown>,
): Record<string, number> {
  const implementation = catalogByKind.get(kind)!;
  const parameters = Object.fromEntries(
    implementation.parameters.map((parameter) => [
      parameter.key,
      normalizedParameter(kind, parameter, rawParameters[parameter.key]),
    ]),
  );

  const constraintError = implementation.validateParameters?.(parameters);
  if (constraintError) {
    throw new Error(constraintError);
  }

  return parameters;
}

function normalizeId(kind: IndicatorKind, rawId: unknown, index: number) {
  if (typeof rawId !== "string") {
    return `${kind}-${index + 1}`;
  }

  const id = rawId.trim().slice(0, 80);
  return id || `${kind}-${index + 1}`;
}

export function normalizeIndicatorSpecs(raw: unknown): IndicatorSpec[] {
  if (!Array.isArray(raw)) {
    throw new Error("indicators must be a JSON array.");
  }
  if (raw.length > maxIndicatorSpecs) {
    throw new Error(`indicators supports up to ${maxIndicatorSpecs} items.`);
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each indicator must be an object.");
    }

    const rawRecord = item as Record<string, unknown>;
    if (typeof rawRecord.kind !== "string" || !isIndicatorKind(rawRecord.kind)) {
      const supported = indicatorCatalog.map((definition) => definition.kind).join(", ");
      throw new Error(`Unsupported indicator kind. Use one of: ${supported}.`);
    }

    const definition = catalogByKind.get(rawRecord.kind)!;
    const rawParameters =
      rawRecord.parameters && typeof rawRecord.parameters === "object" && !Array.isArray(rawRecord.parameters)
        ? (rawRecord.parameters as Record<string, unknown>)
        : {};
    const parameters = normalizeIndicatorParameters(definition.kind, rawParameters);

    return {
      id: normalizeId(definition.kind, rawRecord.id, index),
      kind: definition.kind,
      parameters,
    };
  });
}

function point(timestampMs: number, values: Record<string, number | null>): IndicatorPointResponse {
  return {
    timestamp_ms: timestampMs,
    timestamp: toIsoUtc(timestampMs),
    values,
  };
}

function rounded(value: number | null) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(6));
}

function rsiValue(averageGain: number, averageLoss: number) {
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function emaValues(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  const smoothing = 2 / (period + 1);
  let seedSum = 0;
  let ema: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (index < period) {
      seedSum += value;
    }

    if (index === period - 1) {
      ema = seedSum / period;
      result[index] = ema;
    } else if (index >= period && ema != null) {
      ema = value * smoothing + ema * (1 - smoothing);
      result[index] = ema;
    }
  }

  return result;
}

function emaNullableValues(values: Array<number | null>, period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  const smoothing = 2 / (period + 1);
  const seed: number[] = [];
  let ema: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null) {
      continue;
    }

    if (ema == null) {
      seed.push(value);
      if (seed.length === period) {
        ema = seed.reduce((sum, item) => sum + item, 0) / period;
        result[index] = ema;
      }
      continue;
    }

    ema = value * smoothing + ema * (1 - smoothing);
    result[index] = ema;
  }

  return result;
}

function labelFor(definition: IndicatorDefinition, parameters: Record<string, number>) {
  const parts = definition.parameters.map((parameter) => parameters[parameter.key]);
  return parts.length > 0 ? `${definition.label} ${parts.join("/")}` : definition.label;
}

function computeSma(candles: IndicatorCandle[], period: number) {
  let sum = 0;

  return candles.map((candle, index) => {
    sum += candle.close;
    if (index >= period) {
      sum -= candles[index - period].close;
    }

    return point(candle.timestamp_ms, {
      sma: rounded(index >= period - 1 ? sum / period : null),
    });
  });
}

function computeEma(candles: IndicatorCandle[], period: number) {
  const values = emaValues(candles.map((candle) => candle.close), period);

  return candles.map((candle, index) =>
    point(candle.timestamp_ms, { ema: rounded(values[index]) }),
  );
}

function computeRsi(candles: IndicatorCandle[], period: number) {
  const values: Array<number | null> = Array(candles.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;
  let averageGain: number | null = null;
  let averageLoss: number | null = null;

  for (let index = 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (index <= period) {
      gainSum += gain;
      lossSum += loss;

      if (index === period) {
        averageGain = gainSum / period;
        averageLoss = lossSum / period;
        values[index] = rsiValue(averageGain, averageLoss);
      }
      continue;
    }

    if (averageGain != null && averageLoss != null) {
      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
      values[index] = rsiValue(averageGain, averageLoss);
    }
  }

  return candles.map((candle, index) =>
    point(candle.timestamp_ms, { rsi: rounded(values[index]) }),
  );
}

function computeMacd(
  candles: IndicatorCandle[],
  parameters: Record<string, number>,
) {
  const closes = candles.map((candle) => candle.close);
  const fastEma = emaValues(closes, parameters.fast);
  const slowEma = emaValues(closes, parameters.slow);
  const macd = closes.map((_, index) =>
    fastEma[index] == null || slowEma[index] == null ? null : fastEma[index]! - slowEma[index]!,
  );
  const signal = emaNullableValues(macd, parameters.signal);

  return candles.map((candle, index) =>
    point(candle.timestamp_ms, {
      macd: rounded(macd[index]),
      signal: rounded(signal[index]),
      histogram: rounded(macd[index] == null || signal[index] == null ? null : macd[index]! - signal[index]!),
    }),
  );
}

function computeBollinger(
  candles: IndicatorCandle[],
  period: number,
  standardDeviationMultiplier: number,
) {
  let sum = 0;
  let sumSquares = 0;

  return candles.map((candle, index) => {
    sum += candle.close;
    sumSquares += candle.close * candle.close;
    if (index >= period) {
      const removed = candles[index - period].close;
      sum -= removed;
      sumSquares -= removed * removed;
    }

    if (index < period - 1) {
      return point(candle.timestamp_ms, { upper: null, middle: null, lower: null });
    }

    const middle = sum / period;
    const variance = Math.max(sumSquares / period - middle * middle, 0);
    const standardDeviation = Math.sqrt(variance);

    return point(candle.timestamp_ms, {
      upper: rounded(middle + standardDeviation * standardDeviationMultiplier),
      middle: rounded(middle),
      lower: rounded(middle - standardDeviation * standardDeviationMultiplier),
    });
  });
}

function computeRvol(candles: IndicatorCandle[], period: number) {
  // The average excludes the current bar so a volume spike does not inflate
  // its own baseline.
  let sum = 0;

  return candles.map((candle, index) => {
    const average = index >= period ? sum / period : null;
    const rvol = average != null && average > 0 ? candle.volume / average : null;

    sum += candle.volume;
    if (index >= period) {
      sum -= candles[index - period].volume;
    }

    return point(candle.timestamp_ms, {
      rvol: rounded(rvol),
      average: rounded(average),
    });
  });
}

function computeAtr(candles: IndicatorCandle[], period: number) {
  const values: Array<number | null> = Array(candles.length).fill(null);
  let trueRangeSum = 0;
  let averageTrueRange: number | null = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = index === 0 ? candle.close : candles[index - 1].close;
    const trueRange = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );

    if (index < period) {
      trueRangeSum += trueRange;
    }

    if (index === period - 1) {
      averageTrueRange = trueRangeSum / period;
      values[index] = averageTrueRange;
    } else if (index >= period && averageTrueRange != null) {
      averageTrueRange = (averageTrueRange * (period - 1) + trueRange) / period;
      values[index] = averageTrueRange;
    }
  }

  return candles.map((candle, index) =>
    point(candle.timestamp_ms, { atr: rounded(values[index]) }),
  );
}

export function computeIndicators(
  candles: IndicatorCandle[],
  specs: IndicatorSpec[],
): IndicatorSeriesResponse[] {
  return specs.map((spec) => {
    const implementation = catalogByKind.get(spec.kind)!;
    const parameters = spec.parameters ?? {};

    return {
      id: spec.id ?? spec.kind,
      kind: spec.kind,
      label: labelFor(implementation, parameters),
      placement: implementation.placement,
      parameters,
      values: implementation.values,
      points: implementation.compute(candles, parameters),
    };
  });
}

export function computeIndicatorValueSeries(
  candles: IndicatorCandle[],
  kind: IndicatorKind,
  parameters: Record<string, number>,
  output: string,
): Array<number | null> {
  const implementation = catalogByKind.get(kind)!;
  return implementation.compute(candles, parameters).map((point) => point.values[output] ?? null);
}
