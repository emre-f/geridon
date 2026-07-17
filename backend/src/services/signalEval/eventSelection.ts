import type { Database } from "../../db.ts";
import type { EventKind, EventRecord } from "../../types/events.ts";
import { anchorEvents, type EventAnchor } from "../eventAnchor.ts";
import { getEvents } from "../eventStore.ts";

/** Final ~18 months sealed from every evaluation; consumed once at promotion. */
export const signalHoldoutStartMs = Date.UTC(2025, 0, 1);

/**
 * Universe stats are point-in-time: medians over the trailing window of daily
 * bars ending at the anchor bar t, whose close is known before the entry at
 * t+1. Fixed constants, not tunables.
 */
export const universeWindowBars = 63;
export const minUniverseHistoryBars = 20;

export interface UniverseFilters {
  minPrice?: number;
  minMedianDollarVolume?: number;
}

export interface EventSelectionOptions {
  kind: EventKind;
  minScore?: number;
  payloadFilters?: Record<string, number>;
  universe?: UniverseFilters;
  startMs?: number;
  endMs?: number;
  includeHoldout?: boolean;
}

export interface SelectedEvent {
  event: EventRecord;
  anchor_timestamp_ms: number;
  actionable_timestamp_ms: number;
}

export interface EventSelectionStats {
  candidates: number;
  selected: number;
  tickers: number;
  holdout_clamped: boolean;
  excluded: {
    min_score: number;
    payload_filters: number;
    no_anchor: number;
    insufficient_history: number;
    below_min_price: number;
    below_min_dollar_volume: number;
  };
}

export interface EventSelectionResult {
  events: SelectedEvent[];
  stats: EventSelectionStats;
}

interface DailyBar {
  timestamp_ms: number;
  close: number;
  volume: number;
}

/**
 * Every evaluation consumes events through this selection, so the holdout
 * clamp and the point-in-time universe rules have exactly one place to be
 * right. Payload filters are minimum thresholds on numeric payload fields;
 * boolean fields coerce to 0/1 (so `{ is_officer: 1 }` means officer-only)
 * and missing or non-numeric fields fail the filter.
 */
export function selectEvents(db: Database, options: EventSelectionOptions): EventSelectionResult {
  const requestedEndMs = options.endMs ?? Number.MAX_SAFE_INTEGER;
  const holdoutClamped = options.includeHoldout !== true && requestedEndMs >= signalHoldoutStartMs;
  const endMs = holdoutClamped ? signalHoldoutStartMs - 1 : options.endMs;

  const candidates = getEvents(db, { kind: options.kind, startMs: options.startMs, endMs });
  const stats: EventSelectionStats = {
    candidates: candidates.length,
    selected: 0,
    tickers: 0,
    holdout_clamped: holdoutClamped,
    excluded: {
      min_score: 0,
      payload_filters: 0,
      no_anchor: 0,
      insufficient_history: 0,
      below_min_price: 0,
      below_min_dollar_volume: 0,
    },
  };

  const filtered: EventRecord[] = [];
  for (const event of candidates) {
    if (options.minScore != null && (event.score == null || event.score < options.minScore)) {
      stats.excluded.min_score += 1;
      continue;
    }
    if (options.payloadFilters && !passesPayloadFilters(event.payload, options.payloadFilters)) {
      stats.excluded.payload_filters += 1;
      continue;
    }
    filtered.push(event);
  }

  const barsByTicker = loadDailyBars(db, filtered.map((event) => event.ticker));
  const anchors = anchorsByEvent(filtered, barsByTicker);
  const universe = options.universe;
  const hasUniverseFilters =
    universe?.minPrice != null || universe?.minMedianDollarVolume != null;

  const selected: SelectedEvent[] = [];
  const tickers = new Set<string>();
  filtered.forEach((event, index) => {
    const anchor = anchors[index];
    if (anchor == null || anchor.actionable_timestamp_ms == null) {
      stats.excluded.no_anchor += 1;
      return;
    }

    if (hasUniverseFilters) {
      const bars = barsByTicker.get(event.ticker) ?? [];
      const windowStart = Math.max(0, anchor.anchor_index - universeWindowBars + 1);
      const window = bars.slice(windowStart, anchor.anchor_index + 1);
      if (window.length < minUniverseHistoryBars) {
        stats.excluded.insufficient_history += 1;
        return;
      }
      if (universe?.minPrice != null && median(window.map((bar) => bar.close)) < universe.minPrice) {
        stats.excluded.below_min_price += 1;
        return;
      }
      if (
        universe?.minMedianDollarVolume != null &&
        median(window.map((bar) => bar.close * bar.volume)) < universe.minMedianDollarVolume
      ) {
        stats.excluded.below_min_dollar_volume += 1;
        return;
      }
    }

    tickers.add(event.ticker);
    selected.push({
      event,
      anchor_timestamp_ms: anchor.anchor_timestamp_ms,
      actionable_timestamp_ms: anchor.actionable_timestamp_ms,
    });
  });

  stats.selected = selected.length;
  stats.tickers = tickers.size;
  return { events: selected, stats };
}

function passesPayloadFilters(payload: object, filters: Record<string, number>): boolean {
  return Object.entries(filters).every(([field, threshold]) => {
    const raw = (payload as Record<string, unknown>)[field];
    const value =
      typeof raw === "number" ? raw : typeof raw === "boolean" ? Number(raw) : null;
    return value != null && value >= threshold;
  });
}

function loadDailyBars(db: Database, tickers: Iterable<string>): Map<string, DailyBar[]> {
  const query = db.prepare(`
    SELECT timestamp_ms, close, volume
    FROM candles
    WHERE ticker = ? AND multiplier = 1 AND timespan = 'day'
    ORDER BY timestamp_ms
  `);

  const barsByTicker = new Map<string, DailyBar[]>();
  for (const ticker of new Set(tickers)) {
    const bars = query.all(ticker).map((row) => ({
      timestamp_ms: Number(row.timestamp_ms),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
    barsByTicker.set(ticker, bars);
  }
  return barsByTicker;
}

function anchorsByEvent(
  events: readonly EventRecord[],
  barsByTicker: Map<string, DailyBar[]>,
): Array<EventAnchor | null> {
  const indexesByTicker = new Map<string, number[]>();
  events.forEach((event, index) => {
    const indexes = indexesByTicker.get(event.ticker) ?? [];
    indexes.push(index);
    indexesByTicker.set(event.ticker, indexes);
  });

  const anchors: Array<EventAnchor | null> = new Array(events.length).fill(null);
  for (const [ticker, indexes] of indexesByTicker) {
    const barTimestamps = (barsByTicker.get(ticker) ?? []).map((bar) => bar.timestamp_ms);
    const tickerAnchors = anchorEvents(
      indexes.map((eventIndex) => events[eventIndex].available_ts_ms),
      barTimestamps,
    );
    indexes.forEach((eventIndex, position) => {
      anchors[eventIndex] = tickerAnchors[position];
    });
  }
  return anchors;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
