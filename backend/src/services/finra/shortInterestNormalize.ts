import type { EventRecord } from "../../types/events.ts";
import { endOfDayUtcMs } from "../sec/secTsv.ts";

/**
 * FINRA disseminates each cycle 7 business days after its settlement date. We
 * count plain weekdays with no holiday table, so one extra day absorbs a
 * market holiday inside the window; landing late is conservative, landing
 * early would be lookahead.
 */
export const PUBLICATION_LAG_WEEKDAYS = 8;

/**
 * Fixed at ingestion, never optimized: a spike is a >=50% jump vs the prior
 * cycle in a name where covering takes at least 2 days of volume (FINRA floors
 * days-to-cover at 1, so 1 carries no information). Tighter cuts belong in
 * evaluation-time payload filters, not here.
 */
export const SPIKE_MIN_CHANGE_PERCENT = 50;
export const SPIKE_MIN_DAYS_TO_COVER = 2;

const dayMs = 86_400_000;

export interface ShortInterestSkipCounts {
  missing_symbol: number;
  invalid_settlement_date: number;
  invalid_short_interest: number;
}

export function emptySkipCounts(): ShortInterestSkipCounts {
  return {
    missing_symbol: 0,
    invalid_settlement_date: 0,
    invalid_short_interest: 0,
  };
}

/** Cycles settle on the 15th and the last business day of each month. */
export interface Cycle {
  year: number;
  month: number;
  half: "mid" | "eom";
}

export function cycleLabel({ year, month, half }: Cycle): string {
  return `${year}-${String(month).padStart(2, "0")}-${half}`;
}

export function cycleBoundsMs({ year, month, half }: Cycle): { startMs: number; endMs: number } {
  return half === "mid"
    ? { startMs: Date.UTC(year, month - 1, 1), endMs: endOfDayUtcMs(Date.UTC(year, month - 1, 15)) }
    : { startMs: Date.UTC(year, month - 1, 16), endMs: Date.UTC(year, month, 1) - 1 };
}

export function cyclesInRange(fromYear: number, toYear: number, nowMs: number): Cycle[] {
  const cycles: Cycle[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (const half of ["mid", "eom"] as const) {
        if (cycleBoundsMs({ year, month, half }).endMs < nowMs) {
          cycles.push({ year, month, half });
        }
      }
    }
  }
  return cycles;
}

function isWeekend(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

function weekdayOnOrBefore(ms: number): number {
  let result = ms;
  while (isWeekend(result)) {
    result -= dayMs;
  }
  return result;
}

/**
 * Files are named by the actual settlement date, which shifts backward from
 * the nominal 15th / month-end over weekends and market holidays. We try the
 * nearest weekday first, then walk back a few more; cycles are ~13 days apart
 * so the walk can never reach the previous cycle's file.
 */
export function cycleSettlementCandidatesMs(cycle: Cycle): number[] {
  const target =
    cycle.half === "mid"
      ? Date.UTC(cycle.year, cycle.month - 1, 15)
      : Date.UTC(cycle.year, cycle.month, 0);
  const candidates: number[] = [];
  let candidate = weekdayOnOrBefore(target);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    candidates.push(candidate);
    candidate = weekdayOnOrBefore(candidate - dayMs);
  }
  return candidates;
}

export function addWeekdaysMs(ms: number, weekdays: number): number {
  let result = ms;
  for (let added = 0; added < weekdays; ) {
    result += dayMs;
    if (!isWeekend(result)) {
      added += 1;
    }
  }
  return result;
}

export function publicationAvailableTsMs(settlementDayMs: number): number {
  return endOfDayUtcMs(addWeekdaysMs(settlementDayMs, PUBLICATION_LAG_WEEKDAYS));
}

export type ShortInterestRow = Record<string, string>;

export function parseShortInterestHeader(line: string): string[] {
  return line.split("|").map((name) => name.trim());
}

export function parseShortInterestRow(header: string[], line: string): ShortInterestRow {
  const fields = line.split("|");
  const row: ShortInterestRow = {};
  for (let index = 0; index < header.length; index += 1) {
    row[header[index]] = (fields[index] ?? "").trim();
  }
  return row;
}

function optionalNumber(raw: string): number | null {
  const value = Number(raw);
  return raw !== "" && Number.isFinite(value) ? value : null;
}

export type NormalizeResult =
  | { events: EventRecord<"short_interest_report" | "short_interest_spike">[] }
  | { skip: keyof ShortInterestSkipCounts };

export function normalizeShortInterestRow(row: ShortInterestRow): NormalizeResult {
  const symbol = (row.symbolCode ?? "").toUpperCase().trim();
  if (symbol === "") {
    return { skip: "missing_symbol" };
  }

  const settlementDate = row.settlementDate ?? "";
  const settlementMs = /^\d{4}-\d{2}-\d{2}$/.test(settlementDate)
    ? Date.parse(`${settlementDate}T00:00:00Z`)
    : Number.NaN;
  if (!Number.isFinite(settlementMs)) {
    return { skip: "invalid_settlement_date" };
  }

  const shortInterest = optionalNumber(row.currentShortPositionQuantity ?? "");
  if (shortInterest == null || shortInterest < 0) {
    return { skip: "invalid_short_interest" };
  }

  const previous = optionalNumber(row.previousShortPositionQuantity ?? "");
  const changePercent = optionalNumber(row.changePercent ?? "");
  const averageDailyVolume = optionalNumber(row.averageDailyVolumeQuantity ?? "");
  const daysToCover = optionalNumber(row.daysToCoverQuantity ?? "");

  const payload = {
    settlement_date: settlementDate,
    short_interest: shortInterest,
    previous_short_interest: previous,
    change_percent: changePercent,
    average_daily_volume: averageDailyVolume,
    days_to_cover: daysToCover,
    market_class: (row.marketClassCode ?? "").trim(),
  };
  const eventTsMs = endOfDayUtcMs(settlementMs);
  const availableTsMs = publicationAvailableTsMs(settlementMs);

  const events: EventRecord<"short_interest_report" | "short_interest_spike">[] = [
    {
      source: "finra_short_interest",
      ticker: symbol,
      event_kind: "short_interest_report",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: daysToCover,
      payload,
      dedupe_key: `finra_si:report:${symbol}:${settlementDate}`,
    },
  ];

  const isSpike =
    previous != null &&
    previous > 0 &&
    changePercent != null &&
    changePercent >= SPIKE_MIN_CHANGE_PERCENT &&
    daysToCover != null &&
    daysToCover >= SPIKE_MIN_DAYS_TO_COVER;
  if (isSpike) {
    events.push({
      source: "finra_short_interest",
      ticker: symbol,
      event_kind: "short_interest_spike",
      event_ts_ms: eventTsMs,
      available_ts_ms: availableTsMs,
      score: changePercent,
      payload,
      dedupe_key: `finra_si:spike:${symbol}:${settlementDate}`,
    });
  }

  return { events };
}
