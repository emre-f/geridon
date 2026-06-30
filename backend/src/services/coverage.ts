import type { Database } from "../db.ts";

export type Range = [number, number];

export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [sorted[0]];

  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

export function subtractRanges(
  requestedStart: number,
  requestedEnd: number,
  coveredRanges: Range[],
): Range[] {
  const missing: Range[] = [];
  let cursor = requestedStart;

  for (const [coveredStart, coveredEnd] of mergeRanges(coveredRanges)) {
    if (coveredEnd < cursor) {
      continue;
    }
    if (coveredStart > requestedEnd) {
      break;
    }
    if (coveredStart > cursor) {
      missing.push([cursor, Math.min(coveredStart - 1, requestedEnd)]);
    }
    cursor = Math.max(cursor, coveredEnd + 1);
    if (cursor > requestedEnd) {
      break;
    }
  }

  if (cursor <= requestedEnd) {
    missing.push([cursor, requestedEnd]);
  }

  return missing;
}

export function getMissingRanges(options: {
  db: Database;
  ticker: string;
  multiplier: number;
  timespan: string;
  source: string;
  startMs: number;
  endMs: number;
}): Range[] {
  const covered = options.db
    .prepare(
      `
      SELECT start_ms, end_ms
      FROM fetch_ranges
      WHERE ticker = ?
        AND multiplier = ?
        AND timespan = ?
        AND source = ?
        AND status = 'success'
        AND end_ms >= ?
        AND start_ms <= ?
    `,
    )
    .all(
      options.ticker,
      options.multiplier,
      options.timespan,
      options.source,
      options.startMs,
      options.endMs,
    );

  const clipped = covered.map(
    (row): Range => [
      Math.max(Number(row.start_ms), options.startMs),
      Math.min(Number(row.end_ms), options.endMs),
    ],
  );

  return subtractRanges(options.startMs, options.endMs, clipped);
}
