export interface EventAnchor {
  anchor_index: number;
  anchor_timestamp_ms: number;
  actionable_timestamp_ms: number | null;
}

/**
 * Timing convention: an event whose available_ts falls during or after bar t
 * (any time from bar t's timestamp up to just before bar t+1's) is first
 * actionable at bar t+1. Weekend and after-close availability rolls forward to
 * the next trading bar automatically, because no bar exists in between.
 *
 * The anchor bar t is the key into forward_returns rows, whose entry is
 * already at t+1 per the same convention. Events available before the first
 * bar resolve to null: there is no anchor bar, so they cannot be evaluated.
 * Events anchored to the last bar have no actionable bar yet.
 *
 * anchor_index is the anchor bar's position in the timestamp-sorted bars.
 */
export function anchorEvents(
  availableTimestampsMs: readonly number[],
  barTimestampsMs: readonly number[],
): Array<EventAnchor | null> {
  const bars = [...barTimestampsMs].sort((left, right) => left - right);
  return availableTimestampsMs.map((availableTsMs) => {
    const anchorIndex = lastIndexAtOrBefore(bars, availableTsMs);
    if (anchorIndex < 0) {
      return null;
    }
    return {
      anchor_index: anchorIndex,
      anchor_timestamp_ms: bars[anchorIndex],
      actionable_timestamp_ms: anchorIndex + 1 < bars.length ? bars[anchorIndex + 1] : null,
    };
  });
}

export function anchorEvent(
  availableTsMs: number,
  barTimestampsMs: readonly number[],
): EventAnchor | null {
  return anchorEvents([availableTsMs], barTimestampsMs)[0];
}

function lastIndexAtOrBefore(sortedTimestamps: readonly number[], targetMs: number): number {
  let low = 0;
  let high = sortedTimestamps.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sortedTimestamps[middle] <= targetMs) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
