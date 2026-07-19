import { getSettings } from "../../config.ts";
import { createDb, openDatabase, type Database } from "../../db.ts";
import { getEventCoverage } from "../eventStore.ts";
import type { EventKind } from "../../types/events.ts";
import { emptyCongressSkipCounts, type CongressSkipCounts } from "./ptrNormalize.ts";
import { firstSenateEfdYear, ingestSenatePtrs, type CongressYearSummary } from "./ptrIngest.ts";

const congressKinds: EventKind[] = ["congress_buy", "congress_sell"];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function parseYear(raw: string, nowYear: number): number {
  if (raw === "now") {
    return nowYear;
  }
  const year = Number(raw);
  if (!Number.isInteger(year) || year < firstSenateEfdYear || year > nowYear) {
    throw new Error(`Invalid year "${raw}" (expected ${firstSenateEfdYear}..${nowYear} or "now").`);
  }
  return year;
}

export async function runIngestCongress(args: string[]): Promise<void> {
  const nowYear = new Date().getUTCFullYear();
  const fromYear = parseYear(optionValue(args, "--from=", String(firstSenateEfdYear)), nowYear);
  const toYear = parseYear(optionValue(args, "--to=", "now"), nowYear);
  if (fromYear > toYear) {
    throw new Error("--from must not be after --to.");
  }

  const settings = getSettings();
  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const summaries = await ingestSenatePtrs({
    db,
    fromYear,
    toYear,
    onProgress: (message) => console.log(message),
  });
  printReport(db, summaries);
}

function printReport(db: Database, summaries: CongressYearSummary[]): void {
  const completed = summaries.filter((summary) => summary.status === "completed");
  const alreadyIngested = summaries.length - completed.length;

  let filings = 0;
  let electronic = 0;
  let paper = 0;
  let amendments = 0;
  let malformed = 0;
  let inserted = 0;
  let duplicates = 0;
  let unknownRows = 0;
  const unknownTickers = new Set<string>();
  const skips = emptyCongressSkipCounts();
  for (const summary of completed) {
    filings += summary.filings;
    electronic += summary.electronic_filings;
    paper += summary.paper_filings;
    amendments += summary.amendment_filings;
    malformed += summary.malformed_search_rows;
    inserted += summary.inserted;
    duplicates += summary.duplicates;
    unknownRows += summary.unknown_ticker_rows;
    for (const ticker of summary.unknown_tickers) {
      unknownTickers.add(ticker);
    }
    for (const reason of Object.keys(skips) as Array<keyof CongressSkipCounts>) {
      skips[reason] += summary.skips[reason];
    }
  }

  console.log(`\nYears: ${completed.length} ingested, ${alreadyIngested} already ingested`);
  console.log(
    `Filings: ${filings} total, ${electronic} electronic, ${paper} paper (uningestable scans), ` +
      `${amendments} amendments, ${malformed} malformed rows`,
  );
  console.log(`Events: ${inserted} inserted, ${duplicates} duplicates`);
  const skipParts = Object.entries(skips).map(([reason, count]) => `${reason}=${count}`);
  console.log(
    `Skipped rows: unknown_ticker=${unknownRows} (${unknownTickers.size} distinct tickers), ` +
      skipParts.join(", "),
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    if (!congressKinds.includes(row.event_kind)) {
      continue;
    }
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = congressKinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}
