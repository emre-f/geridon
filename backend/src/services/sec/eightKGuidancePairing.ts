import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import type { GuidanceEventKind } from "./eightKGuidanceEvents.ts";

/**
 * Guidance and results ship in the same 8-K press release, but the earnings
 * source's conservative after-close rule can put the two timestamps up to a
 * day apart in either direction. 36 hours captures the same-release pair while
 * excluding a genuinely separate announcement (>= 2 days), which would be
 * lookahead to pair with.
 */
export const pairingWindowMs = 36 * 60 * 60 * 1000;

export interface EarningsAnchor {
  event_ts_ms: number;
  beat: boolean;
  score: number | null;
}

export interface PairingCounts {
  paired_beat: number;
  paired_miss: number;
  unpaired: number;
}

export function loadEarningsAnchors(db: Database): Map<string, EarningsAnchor[]> {
  const rows = db
    .prepare(`
      SELECT ticker, event_kind, event_ts_ms, score
      FROM events
      WHERE event_kind IN ('earnings_beat', 'earnings_miss')
      ORDER BY ticker, event_ts_ms
    `)
    .all();

  const byTicker = new Map<string, EarningsAnchor[]>();
  for (const row of rows) {
    const ticker = String(row.ticker);
    const bucket = byTicker.get(ticker) ?? [];
    bucket.push({
      event_ts_ms: Number(row.event_ts_ms),
      beat: String(row.event_kind) === "earnings_beat",
      score: row.score == null ? null : Number(row.score),
    });
    byTicker.set(ticker, bucket);
  }
  return byTicker;
}

/**
 * Stamps each guidance event with the nearest same-ticker earnings event inside
 * the pairing window: paired_beat/paired_miss become evaluation-time payload
 * filters, so the beat+raise interaction buckets need no join machinery.
 */
export function pairGuidanceEvents(
  events: Array<EventRecord<GuidanceEventKind>>,
  anchorsByTicker: Map<string, EarningsAnchor[]>,
): PairingCounts {
  const counts: PairingCounts = { paired_beat: 0, paired_miss: 0, unpaired: 0 };

  for (const event of events) {
    const anchors = anchorsByTicker.get(event.ticker) ?? [];
    let nearest: EarningsAnchor | null = null;
    let nearestGap = Infinity;
    for (const anchor of anchors) {
      const gap = Math.abs(anchor.event_ts_ms - event.event_ts_ms);
      if (gap <= pairingWindowMs && gap < nearestGap) {
        nearest = anchor;
        nearestGap = gap;
      }
    }

    if (nearest == null) {
      counts.unpaired += 1;
      continue;
    }
    event.payload.paired_beat = nearest.beat ? 1 : 0;
    event.payload.paired_miss = nearest.beat ? 0 : 1;
    event.payload.paired_surprise = nearest.score;
    if (nearest.beat) {
      counts.paired_beat += 1;
    } else {
      counts.paired_miss += 1;
    }
  }

  return counts;
}
