type NumericSeries = Array<number | null>;

export interface SharedSeriesScope {
  get(operandKey: string): NumericSeries | undefined;
  set(operandKey: string, series: NumericSeries): void;
}

export interface IndicatorSeriesCache {
  scope(symbol: string, startIndex: number, endIndex: number): SharedSeriesScope;
  stats: { hits: number; misses: number; evictions: number };
  size: number;
}

export const defaultCacheMaxValues = 2_000_000;

/**
 * Bounded LRU cache for indicator series keyed by symbol, candle-slice range,
 * and indicator spec. Series are computed on immutable candle slices, so a
 * cached series is valid for every candidate that evaluates the same fold.
 * The bound counts stored values (8-byte numbers), not entries, so one run
 * stays within a predictable memory budget.
 */
export function createIndicatorSeriesCache(
  maxValues = defaultCacheMaxValues,
): IndicatorSeriesCache {
  const entries = new Map<string, NumericSeries>();
  const stats = { hits: 0, misses: 0, evictions: 0 };
  let totalValues = 0;

  function get(key: string): NumericSeries | undefined {
    const series = entries.get(key);
    if (!series) {
      stats.misses += 1;
      return undefined;
    }
    stats.hits += 1;
    entries.delete(key);
    entries.set(key, series);
    return series;
  }

  function set(key: string, series: NumericSeries) {
    if (entries.has(key) || series.length > maxValues) {
      return;
    }
    entries.set(key, series);
    totalValues += series.length;
    while (totalValues > maxValues) {
      const oldestKey = entries.keys().next().value as string;
      totalValues -= entries.get(oldestKey)!.length;
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
  }

  return {
    scope(symbol, startIndex, endIndex) {
      const prefix = `${symbol}:${startIndex}:${endIndex}:`;
      return {
        get: (operandKey) => get(prefix + operandKey),
        set: (operandKey, series) => set(prefix + operandKey, series),
      };
    },
    stats,
    get size() {
      return entries.size;
    },
  };
}
