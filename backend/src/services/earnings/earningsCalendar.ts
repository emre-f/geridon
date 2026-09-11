import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const earningsCalendarBaseUrl = "https://api.nasdaq.com/api/calendar/earnings";

/** The NASDAQ calendar has no rows before 2008; earlier years are never requested. */
export const firstEarningsYear = 2008;

/** The calendar API only answers browser-like clients; requests without this hang. */
const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface Month {
  year: number;
  month: number;
}

export function monthLabel({ year, month }: Month): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthBoundsMs({ year, month }: Month): { startMs: number; endMs: number } {
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1) - 1;
  return { startMs, endMs };
}

/** Months from fromYear January through the last month fully ended before nowMs. */
export function monthsInRange(fromYear: number, toYear: number, nowMs: number): Month[] {
  const months: Month[] = [];
  for (let year = Math.max(fromYear, firstEarningsYear); year <= toYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (monthBoundsMs({ year, month }).endMs < nowMs) {
        months.push({ year, month });
      }
    }
  }
  return months;
}

/** ISO dates of the month's Mondays through Fridays; the calendar has no weekend rows. */
export function weekdayDatesInMonth({ year, month }: Month): string[] {
  const dates: string[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const dayMs = Date.UTC(year, month - 1, day);
    const date = new Date(dayMs);
    if (date.getUTCMonth() !== month - 1) {
      break;
    }
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      dates.push(date.toISOString().slice(0, 10));
    }
  }
  return dates;
}

export interface EarningsCalendarRow {
  symbol: string;
  eps: string;
  epsForecast: string;
  time: string;
  fiscalQuarterEnding: string;
  noOfEsts: string;
}

interface CalendarPayload {
  data?: { rows?: EarningsCalendarRow[] | null } | null;
}

export interface DayData {
  rows: EarningsCalendarRow[];
  fetched: boolean;
}

/**
 * One cached JSON file per calendar day is the cache unit; a cached day is
 * never re-fetched. Downloads land on a .partial path first so an interrupted
 * run cannot poison the cache. Empty days (holidays, pre-2008 gaps) cache the
 * empty payload and stay empty.
 */
export async function ensureDayData(
  dateIso: string,
  cacheDir: string,
  baseUrl: string = earningsCalendarBaseUrl,
): Promise<DayData> {
  const dayPath = join(cacheDir, dateIso.slice(0, 7), `${dateIso}.json`);
  if (existsSync(dayPath)) {
    return { rows: parseRows(await readFile(dayPath, "utf8")), fetched: false };
  }

  const response = await fetch(`${baseUrl}?date=${dateIso}`, {
    headers: { "User-Agent": browserUserAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`NASDAQ calendar request failed for ${dateIso}: HTTP ${response.status}`);
  }
  const body = await response.text();
  const rows = parseRows(body);

  await mkdir(join(cacheDir, dateIso.slice(0, 7)), { recursive: true });
  const partialPath = `${dayPath}.partial`;
  await writeFile(partialPath, body);
  await rename(partialPath, dayPath);
  return { rows, fetched: true };
}

function parseRows(body: string): EarningsCalendarRow[] {
  const payload = JSON.parse(body) as CalendarPayload;
  return payload.data?.rows ?? [];
}
