import { getSettings } from "../../config.ts";
import { createDb, openDatabase, type Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { getEventCoverage } from "../eventStore.ts";
import { firstEarningsYear } from "./earningsCalendar.ts";
import { ingestEarnings, type EarningsMonthSummary } from "./earningsIngest.ts";
import { emptyEarningsSkipCounts, type EarningsSkipCounts } from "./earningsNormalize.ts";

const earningsKinds: EventKind[] = ["earnings_beat", "earnings_miss"];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function parseYear(raw: string, nowYear: number): number {
  if (raw === "now") {
    return nowYear;
  }
  const year = Number(raw);
  if (!Number.isInteger(year) || year < firstEarningsYear || year > nowYear) {
    throw new Error(`Invalid year "${raw}" (expected ${firstEarningsYear}..${nowYear} or "now").`);
  }
  return year;
}

export async function runIngestEarnings(args: string[]): Promise<void> {
  const settings = getSettings();
  const nowYear = new Date().getUTCFullYear();
  const fromYear = parseYear(optionValue(args, "--from=", String(firstEarningsYear)), nowYear);
  const toYear = parseYear(optionValue(args, "--to=", "now"), nowYear);
  if (fromYear > toYear) {
    throw new Error("--from must not be after --to.");
  }

  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const summaries = await ingestEarnings({
    db,
    fromYear,
    toYear,
    onProgress: (message) => console.log(message),
  });
  printReport(db, summaries);
}

function printReport(db: Database, summaries: EarningsMonthSummary[]): void {
  const completed = summaries.filter((summary) => summary.status === "completed");
  const alreadyIngested = summaries.length - completed.length;

  let inserted = 0;
  let duplicates = 0;
  let unknownRows = 0;
  const unknownTickers = new Set<string>();
  const skips = emptyEarningsSkipCounts();
  for (const summary of completed) {
    inserted += summary.inserted;
    duplicates += summary.duplicates;
    unknownRows += summary.unknown_ticker_rows;
    for (const ticker of summary.unknown_tickers) {
      unknownTickers.add(ticker);
    }
    for (const reason of Object.keys(skips) as Array<keyof EarningsSkipCounts>) {
      skips[reason] += summary.skips[reason];
    }
  }

  console.log(`\nMonths: ${completed.length} ingested, ${alreadyIngested} already ingested`);
  console.log(`Events: ${inserted} inserted, ${duplicates} duplicates`);
  const skipParts = Object.entries(skips).map(([reason, count]) => `${reason}=${count}`);
  console.log(
    `Skipped rows: unknown_ticker=${unknownRows} (${unknownTickers.size} distinct tickers), ` +
      skipParts.join(", "),
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    if (!earningsKinds.includes(row.event_kind)) {
      continue;
    }
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = earningsKinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}
