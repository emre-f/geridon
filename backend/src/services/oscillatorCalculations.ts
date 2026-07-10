import {
  computeBollinger,
  point,
  rounded,
  type IndicatorCandle,
} from "./indicatorCalculations.ts";

export function computeMomentum(candles: IndicatorCandle[], period: number) {
  return candles.map((candle, index) => {
    const past = index >= period ? candles[index - period].close : null;
    const momentum = past != null && past !== 0 ? candle.close / past - 1 : null;
    return point(candle.timestamp_ms, { momentum: rounded(momentum) });
  });
}

export function computeCci(candles: IndicatorCandle[], period: number) {
  const typicalPrices = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
  let sum = 0;

  return candles.map((candle, index) => {
    sum += typicalPrices[index];
    if (index >= period) {
      sum -= typicalPrices[index - period];
    }

    if (index < period - 1) {
      return point(candle.timestamp_ms, { cci: null });
    }

    const mean = sum / period;
    let deviationSum = 0;
    for (let offset = 0; offset < period; offset += 1) {
      deviationSum += Math.abs(typicalPrices[index - offset] - mean);
    }
    const meanDeviation = deviationSum / period;
    const cci =
      meanDeviation === 0 ? null : (typicalPrices[index] - mean) / (0.015 * meanDeviation);

    return point(candle.timestamp_ms, { cci: rounded(cci) });
  });
}

export function computeBbp(
  candles: IndicatorCandle[],
  period: number,
  standardDeviationMultiplier: number,
) {
  const bands = computeBollinger(candles, period, standardDeviationMultiplier);

  return candles.map((candle, index) => {
    const { upper, lower } = bands[index].values;
    const bbp =
      upper == null || lower == null || upper === lower
        ? null
        : (candle.close - lower) / (upper - lower);
    return point(candle.timestamp_ms, { bbp: rounded(bbp) });
  });
}
