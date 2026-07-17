import type { CloseBar } from "../forwardReturns.ts";
import { SeededRandom } from "../optimization/random.ts";
import { bootstrapGapBand, meanByHorizon } from "./eventStudyStats.ts";

export const eventStudyMaxHorizon = 63;
export const defaultBootstrapIterations = 200;

export interface StudyEvent {
  ticker: string;
  anchor_timestamp_ms: number;
}

export interface EventStudyOptions {
  events: readonly StudyEvent[];
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>;
  marketBars: readonly CloseBar[];
  seed: number;
  maxHorizon?: number;
  bootstrapIterations?: number;
}

export interface EventStudyPoint {
  horizon: number;
  signal_mean: number | null;
  signal_events: number;
  baseline_mean: number | null;
  baseline_events: number;
  gap: number | null;
  gap_lower: number | null;
  gap_upper: number | null;
}

export interface EventStudyResult {
  n_events: number;
  n_tickers: number;
  seed: number;
  bootstrap_iterations: number;
  events_per_year: Array<{ year: number; count: number }>;
  curve: EventStudyPoint[];
}

interface TickerSeries {
  bars: CloseBar[];
  indexByTimestamp: Map<number, number>;
  eventAnchorIndexes: Set<number>;
}

/**
 * Pooled event study: mean cumulative market-adjusted return for bars
 * t+1 … t+maxHorizon after each event's anchor bar t, against a matched
 * baseline — same tickers, seeded random non-event anchor dates within the
 * study's anchor date range, same count, same missing-data handling. The
 * bootstrap band is on the signal-minus-baseline gap: events are resampled
 * with replacement and both curves recomputed per resample. Deterministic for
 * a given seed regardless of input event order.
 */
export function runEventStudy(options: EventStudyOptions): EventStudyResult {
  const maxHorizon = options.maxHorizon ?? eventStudyMaxHorizon;
  const bootstrapIterations = options.bootstrapIterations ?? defaultBootstrapIterations;
  const events = [...options.events].sort(
    (left, right) =>
      left.ticker.localeCompare(right.ticker) ||
      left.anchor_timestamp_ms - right.anchor_timestamp_ms,
  );
  const seriesByTicker = buildSeries(events, options.barsByTicker);
  const marketCloses = new Map(options.marketBars.map((bar) => [bar.timestamp_ms, bar.close]));
  const rng = new SeededRandom(options.seed);

  const anchorRange = {
    minMs: Math.min(...events.map((event) => event.anchor_timestamp_ms)),
    maxMs: Math.max(...events.map((event) => event.anchor_timestamp_ms)),
  };

  const signalCurves: Float64Array[] = [];
  const baselineCurves: Float64Array[] = [];
  for (const event of events) {
    const series = seriesByTicker.get(event.ticker);
    const anchorIndex = series?.indexByTimestamp.get(event.anchor_timestamp_ms) ?? null;
    signalCurves.push(curveFromAnchor(series, anchorIndex, marketCloses, maxHorizon));
    const baselineIndex = series ? sampleBaselineAnchor(series, anchorRange, rng) : null;
    baselineCurves.push(curveFromAnchor(series, baselineIndex, marketCloses, maxHorizon));
  }

  const signal = meanByHorizon(signalCurves, maxHorizon);
  const baseline = meanByHorizon(baselineCurves, maxHorizon);
  const band = bootstrapGapBand(signalCurves, baselineCurves, maxHorizon, bootstrapIterations, rng);

  const curve: EventStudyPoint[] = [];
  for (let k = 0; k < maxHorizon; k += 1) {
    const gap =
      signal.mean[k] != null && baseline.mean[k] != null
        ? (signal.mean[k] as number) - (baseline.mean[k] as number)
        : null;
    curve.push({
      horizon: k + 1,
      signal_mean: signal.mean[k],
      signal_events: signal.count[k],
      baseline_mean: baseline.mean[k],
      baseline_events: baseline.count[k],
      gap,
      gap_lower: band.lower[k],
      gap_upper: band.upper[k],
    });
  }

  return {
    n_events: events.length,
    n_tickers: new Set(events.map((event) => event.ticker)).size,
    seed: options.seed,
    bootstrap_iterations: bootstrapIterations,
    events_per_year: countEventsPerYear(events),
    curve,
  };
}

function buildSeries(
  events: readonly StudyEvent[],
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>,
): Map<string, TickerSeries> {
  const seriesByTicker = new Map<string, TickerSeries>();
  for (const ticker of new Set(events.map((event) => event.ticker))) {
    const bars = [...(barsByTicker.get(ticker) ?? [])].sort(
      (left, right) => left.timestamp_ms - right.timestamp_ms,
    );
    seriesByTicker.set(ticker, {
      bars,
      indexByTimestamp: new Map(bars.map((bar, index) => [bar.timestamp_ms, index])),
      eventAnchorIndexes: new Set(),
    });
  }
  for (const event of events) {
    const series = seriesByTicker.get(event.ticker);
    const anchorIndex = series?.indexByTimestamp.get(event.anchor_timestamp_ms);
    if (series && anchorIndex != null) {
      series.eventAnchorIndexes.add(anchorIndex);
    }
  }
  return seriesByTicker;
}

function curveFromAnchor(
  series: TickerSeries | undefined,
  anchorIndex: number | null,
  marketCloses: Map<number, number>,
  maxHorizon: number,
): Float64Array {
  const curve = new Float64Array(maxHorizon).fill(Number.NaN);
  const entry = anchorIndex == null ? undefined : series?.bars[anchorIndex + 1];
  if (series == null || anchorIndex == null || entry == null || entry.close <= 0) {
    return curve;
  }
  const entryMarketClose = marketCloses.get(entry.timestamp_ms);
  for (let k = 1; k <= maxHorizon; k += 1) {
    const exit = series.bars[anchorIndex + 1 + k];
    if (exit == null) {
      break;
    }
    const exitMarketClose = marketCloses.get(exit.timestamp_ms);
    if (entryMarketClose == null || entryMarketClose <= 0 || exitMarketClose == null) {
      continue;
    }
    const raw = exit.close / entry.close - 1;
    curve[k - 1] = raw - (exitMarketClose / entryMarketClose - 1);
  }
  return curve;
}

function sampleBaselineAnchor(
  series: TickerSeries,
  anchorRange: { minMs: number; maxMs: number },
  rng: SeededRandom,
): number | null {
  const anchorable = series.bars
    .map((_, index) => index)
    .filter((index) => index + 1 < series.bars.length && !series.eventAnchorIndexes.has(index));
  const inRange = anchorable.filter((index) => {
    const timestampMs = series.bars[index].timestamp_ms;
    return timestampMs >= anchorRange.minMs && timestampMs <= anchorRange.maxMs;
  });
  const candidates = inRange.length > 0 ? inRange : anchorable;
  return candidates.length > 0 ? rng.pick(candidates) : null;
}

function countEventsPerYear(events: readonly StudyEvent[]): Array<{ year: number; count: number }> {
  if (events.length === 0) {
    return [];
  }
  const countByYear = new Map<number, number>();
  for (const event of events) {
    const year = new Date(event.anchor_timestamp_ms).getUTCFullYear();
    countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
  }
  const years = [...countByYear.keys()];
  const perYear: Array<{ year: number; count: number }> = [];
  for (let year = Math.min(...years); year <= Math.max(...years); year += 1) {
    perYear.push({ year, count: countByYear.get(year) ?? 0 });
  }
  return perYear;
}
