import { getSettings } from "../../config.ts";
import { createDb, openDatabase, type Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { getEventCoverage } from "../eventStore.ts";
import { firstPeriodYear } from "./managers.ts";
import { emptyThirteenFSkipCounts, type ThirteenFSkipCounts } from "./thirteenFNormalize.ts";
import { ingestThirteenF } from "./thirteenFIngest.ts";
import type { ThirteenFQuarterSummary } from "./quarterIngest.ts";

const thirteenFKinds: EventKind[] = ["inst_new_stake", "inst_exit"];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function parseYear(raw: string, nowYear: number): number {
  if (raw === "now") {
    return nowYear;
  }
  const year = Number(raw);
  if (!Number.isInteger(year) || year < firstPeriodYear || year > nowYear) {
    throw new Error(`Invalid year "${raw}" (expected ${firstPeriodYear}..${nowYear} or "now").`);
  }
  return year;
}

export async function runIngestThirteenF(args: string[]): Promise<void> {
  const settings = getSettings();
  if (!settings.secUserAgent) {
    throw new Error(
      "SEC_USER_AGENT is not configured. SEC requires a declared contact on every request; " +
        'set it in backend/.env, e.g. SEC_USER_AGENT="geridon/0.1 you@example.com".',
    );
  }

  const nowYear = new Date().getUTCFullYear();
  const fromYear = parseYear(optionValue(args, "--from=", String(firstPeriodYear)), nowYear);
  const toYear = parseYear(optionValue(args, "--to=", "now"), nowYear);
  if (fromYear > toYear) {
    throw new Error("--from must not be after --to.");
  }

  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const summaries = await ingestThirteenF({
    db,
    fromYear,
    toYear,
    userAgent: settings.secUserAgent,
    onProgress: (message) => console.log(message),
  });
  printReport(db, summaries);
}

function printReport(db: Database, summaries: ThirteenFQuarterSummary[]): void {
  const completed = summaries.filter((summary) => summary.status === "completed");
  const alreadyIngested = summaries.length - completed.length;

  let inserted = 0;
  let duplicates = 0;
  let unknownRows = 0;
  let amendments = 0;
  const unknownTickers = new Set<string>();
  const skips = emptyThirteenFSkipCounts();
  let maxUnmapped = 0;
  for (const summary of completed) {
    inserted += summary.inserted;
    duplicates += summary.duplicates;
    unknownRows += summary.unknown_ticker_rows;
    amendments += summary.amendments_ignored;
    maxUnmapped = Math.max(maxUnmapped, summary.unmapped_cusips);
    for (const ticker of summary.unknown_tickers) {
      unknownTickers.add(ticker);
    }
    for (const reason of Object.keys(skips) as Array<keyof ThirteenFSkipCounts>) {
      skips[reason] += summary.skips[reason];
    }
  }

  console.log(`\nQuarters: ${completed.length} ingested, ${alreadyIngested} already ingested`);
  console.log(
    `Events: ${inserted} inserted, ${duplicates} duplicates; ${amendments} amendments ignored`,
  );
  const skipParts = Object.entries(skips).map(([reason, count]) => `${reason}=${count}`);
  console.log(
    `Skipped rows: unknown_ticker=${unknownRows} (${unknownTickers.size} distinct tickers), ` +
      `${skipParts.join(", ")} (max distinct unmapped cusips in a quarter: ${maxUnmapped})`,
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    if (!thirteenFKinds.includes(row.event_kind)) {
      continue;
    }
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = thirteenFKinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}
