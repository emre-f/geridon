import { toIsoUtc } from "../datetime.ts";
import type { CandleResponse, IndicatorPointResponse } from "../types.ts";

export type IndicatorCandle = Pick<
  CandleResponse,
  "timestamp_ms" | "open" | "high" | "low" | "close" | "volume"
>;

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

export function computeSma(candles: IndicatorCandle[], period: number) {
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

export function computeEma(candles: IndicatorCandle[], period: number) {
  const values = emaValues(candles.map((candle) => candle.close), period);

  return candles.map((candle, index) =>
    point(candle.timestamp_ms, { ema: rounded(values[index]) }),
  );
}

export function computeRsi(candles: IndicatorCandle[], period: number) {
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

export function computeMacd(
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
      histogram: rounded(
        macd[index] == null || signal[index] == null ? null : macd[index]! - signal[index]!,
      ),
    }),
  );
}

export function computeBollinger(
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

export function computeRvol(candles: IndicatorCandle[], period: number) {
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

export function computeAtr(candles: IndicatorCandle[], period: number) {
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
