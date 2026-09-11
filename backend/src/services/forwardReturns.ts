export const labelVersion = 1;

export const forwardReturnHorizons = [1, 5, 10, 21, 63] as const;

export type ForwardReturnHorizon = (typeof forwardReturnHorizons)[number];

export interface CloseBar {
  timestamp_ms: number;
  close: number;
}

export interface ForwardReturnRow {
  timestamp_ms: number;
  horizon: number;
  raw: number | null;
  market_adjusted: number | null;
}

function sortedByTimestamp(bars: CloseBar[]): CloseBar[] {
  return [...bars].sort((left, right) => left.timestamp_ms - right.timestamp_ms);
}

function closeByTimestamp(bars: CloseBar[]): Map<number, number> {
  const closes = new Map<number, number>();
  for (const bar of bars) {
    closes.set(bar.timestamp_ms, bar.close);
  }
  return closes;
}

function returnBetween(entryClose: number | undefined, exitClose: number | undefined): number | null {
  if (entryClose == null || exitClose == null || entryClose <= 0) {
    return null;
  }
  return exitClose / entryClose - 1;
}

/**
 * Forward returns per the timing convention: an event known during or after
 * bar t's close is first actionable at bar t+1, so the horizon-k return for
 * date t is close(t+1+k) / close(t+1) - 1.
 *
 * Market adjustment subtracts the market's return over the identical calendar
 * window: market closes are matched by the entry and exit bars' timestamps,
 * never by bar offset, so gaps in the ticker's history cannot misalign it.
 */
export function computeForwardReturns(options: {
  bars: CloseBar[];
  marketBars?: CloseBar[];
  horizons?: readonly number[];
}): ForwardReturnRow[] {
  const bars = sortedByTimestamp(options.bars);
  const horizons = options.horizons ?? forwardReturnHorizons;
  const marketCloses = options.marketBars ? closeByTimestamp(options.marketBars) : null;

  const rows: ForwardReturnRow[] = [];
  for (let index = 0; index < bars.length; index += 1) {
    const entry = bars[index + 1];
    for (const horizon of horizons) {
      const exit = bars[index + 1 + horizon];
      const raw = entry && exit ? returnBetween(entry.close, exit.close) : null;

      let marketAdjusted: number | null = null;
      if (raw != null && marketCloses && entry && exit) {
        const marketReturn = returnBetween(
          marketCloses.get(entry.timestamp_ms),
          marketCloses.get(exit.timestamp_ms),
        );
        marketAdjusted = marketReturn == null ? null : raw - marketReturn;
      }

      rows.push({
        timestamp_ms: bars[index].timestamp_ms,
        horizon,
        raw,
        market_adjusted: marketAdjusted,
      });
    }
  }
  return rows;
}
