import type { EarningsSurprisePayload, EventRecord } from "../../types/events.ts";
import type { EarningsCalendarRow } from "./earningsCalendar.ts";

const dayMs = 86_400_000;

export interface EarningsSkipCounts {
  missing_symbol: number;
  missing_actual: number;
  missing_estimate: number;
  zero_surprise: number;
}

export function emptyEarningsSkipCounts(): EarningsSkipCounts {
  return {
    missing_symbol: 0,
    missing_actual: 0,
    missing_estimate: 0,
    zero_surprise: 0,
  };
}

/** Calendar EPS strings look like "$0.85", "($0.09)", "$1,234.00"; blanks and N/A are null. */
export function parseEpsValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "N/A") {
    return null;
  }
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const inner = negative ? trimmed.slice(1, -1) : trimmed;
  const value = Number(inner.replace(/[$,]/g, ""));
  if (!Number.isFinite(value)) {
    return null;
  }
  return negative ? -value : value;
}

const fiscalMonths: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** "Sep/2024" becomes "2024-09"; unparseable values fall back to null. */
export function parseFiscalPeriod(raw: string): string | null {
  const match = /^([A-Za-z]{3})\/(\d{4})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const month = fiscalMonths[match[1].toUpperCase()];
  if (month == null) {
    return null;
  }
  return `${match[2]}-${String(month).padStart(2, "0")}`;
}

export type AnnounceTime = EarningsSurprisePayload["announce_time"];

export function parseAnnounceTime(raw: string): AnnounceTime {
  if (raw === "time-pre-market") {
    return "pre-market";
  }
  if (raw === "time-after-hours") {
    return "after-hours";
  }
  return "not-supplied";
}

/**
 * The point-in-time rule: a pre-market announcement is public before that
 * day's bar, so it stamps just before the day's bar timestamp and anchors to
 * the prior bar (actionable at that same open). After-hours and unsupplied
 * times stamp end of day — the conservative assumption the plan mandates —
 * anchoring to the day's bar (actionable at the next open).
 */
export function announcementAvailabilityMs(dayStartMs: number, time: AnnounceTime): number {
  return time === "pre-market" ? dayStartMs - 1 : dayStartMs + dayMs - 1;
}

export type NormalizeEarningsResult =
  | { event: EventRecord<"earnings_beat" | "earnings_miss"> }
  | { skip: keyof EarningsSkipCounts };

/**
 * Score is |actual - estimate| / prior close: the standardized surprise with
 * price as the scale (per-analyst dispersion is not in this feed), absolute so
 * min-score filters rank misses by magnitude too. The signed value lives in
 * the payload. When the ticker has no daily close at or before the
 * announcement (candle history starts later) the event is kept with a null
 * score, so the events table does not bake in today's candle coverage.
 * The dedupe key is symbol + fiscal period, so an announcement
 * that appears on two calendar dates lands once; the calendar-date fallback
 * covers rows with no parseable fiscal period. The feed's marketCap column is
 * the CURRENT market cap even on historical dates — lookahead, never used.
 */
export function normalizeEarningsRow(
  row: EarningsCalendarRow,
  dateIso: string,
  priorCloseAt: (ticker: string, atMs: number) => number | null,
): NormalizeEarningsResult {
  const symbol = row.symbol?.toUpperCase().trim();
  if (!symbol) {
    return { skip: "missing_symbol" };
  }
  const actual = parseEpsValue(row.eps ?? "");
  if (actual == null) {
    return { skip: "missing_actual" };
  }
  const estimate = parseEpsValue(row.epsForecast ?? "");
  if (estimate == null) {
    return { skip: "missing_estimate" };
  }
  if (actual === estimate) {
    return { skip: "zero_surprise" };
  }

  const dayStartMs = Date.parse(`${dateIso}T00:00:00Z`);
  const announceTime = parseAnnounceTime(row.time ?? "");
  const availableTsMs = announcementAvailabilityMs(dayStartMs, announceTime);

  const priorClose = priorCloseAt(symbol, availableTsMs);
  const standardizedSurprise =
    priorClose == null || priorClose <= 0 ? null : (actual - estimate) / priorClose;
  const numEstimatesRaw = Number(row.noOfEsts);
  const fiscalPeriod = parseFiscalPeriod(row.fiscalQuarterEnding ?? "");

  return {
    event: {
      source: "nasdaq_earnings",
      ticker: symbol,
      event_kind: actual > estimate ? "earnings_beat" : "earnings_miss",
      event_ts_ms: availableTsMs,
      available_ts_ms: availableTsMs,
      score: standardizedSurprise == null ? null : Math.abs(standardizedSurprise),
      payload: {
        eps_actual: actual,
        eps_estimate: estimate,
        num_estimates: Number.isInteger(numEstimatesRaw) && numEstimatesRaw > 0 ? numEstimatesRaw : null,
        standardized_surprise: standardizedSurprise,
        announce_time: announceTime,
        fiscal_period: fiscalPeriod ?? dateIso,
      },
      dedupe_key: `nasdaq_earnings:${symbol}:${fiscalPeriod ?? `d:${dateIso}`}`,
    },
  };
}
