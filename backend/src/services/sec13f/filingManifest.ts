import type { Edgar13fClient, ManagerFiling } from "./edgarClient.ts";
import { curatedManagers, type CuratedManager } from "./managers.ts";

export interface Quarter {
  year: number;
  quarter: number;
}

export function quarterLabel({ year, quarter }: Quarter): string {
  return `${year}q${quarter}`;
}

export function quarterBoundsMs({ year, quarter }: Quarter): { startMs: number; endMs: number } {
  const startMs = Date.UTC(year, (quarter - 1) * 3, 1);
  const nextStartMs = quarter === 4 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, quarter * 3, 1);
  return { startMs, endMs: nextStartMs - 1 };
}

export function periodString({ year, quarter }: Quarter): string {
  const ends = ["03-31", "06-30", "09-30", "12-31"];
  return `${year}-${ends[quarter - 1]}`;
}

export function priorQuarter({ year, quarter }: Quarter): Quarter {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/**
 * Manager filing pairs for one report quarter. Only original 13F-HR filings
 * are used — amendments restate or extend confidentially-withheld positions
 * after the fact, so diffing them would blend information the market got at
 * different times; they are counted and skipped. When a period somehow has
 * several originals, the earliest acceptance wins (the first public view).
 */
export interface QuarterManifestEntry {
  cik: number;
  name: string;
  current: ManagerFiling | null;
  prior: ManagerFiling | null;
  amendments: number;
}

function originalForPeriod(filings: ManagerFiling[], period: string): ManagerFiling | null {
  let earliest: ManagerFiling | null = null;
  for (const filing of filings) {
    if (filing.form !== "13F-HR" || filing.period !== period) {
      continue;
    }
    if (earliest == null || filing.acceptance_ms < earliest.acceptance_ms) {
      earliest = filing;
    }
  }
  return earliest;
}

export function createFilingDiscovery(
  getClient: () => Edgar13fClient,
): (cik: number) => Promise<ManagerFiling[]> {
  const cache = new Map<number, Promise<ManagerFiling[]>>();
  return (cik: number) => {
    let pending = cache.get(cik);
    if (pending == null) {
      pending = getClient().fetchManagerFilings(cik);
      cache.set(cik, pending);
    }
    return pending;
  };
}

export async function buildQuarterManifest(
  discover: (cik: number) => Promise<ManagerFiling[]>,
  quarter: Quarter,
  managers: readonly CuratedManager[] = curatedManagers,
): Promise<QuarterManifestEntry[]> {
  const period = periodString(quarter);
  const prevPeriod = periodString(priorQuarter(quarter));

  const entries: QuarterManifestEntry[] = [];
  for (const manager of managers) {
    const filings = await discover(manager.cik);
    entries.push({
      cik: manager.cik,
      name: manager.name,
      current: originalForPeriod(filings, period),
      prior: originalForPeriod(filings, prevPeriod),
      amendments: filings.filter(
        (filing) => filing.form === "13F-HR/A" && filing.period === period,
      ).length,
    });
  }
  return entries;
}
