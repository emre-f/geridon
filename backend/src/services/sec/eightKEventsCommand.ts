import { getSettings } from "../../config.ts";
import { createDb, openDatabase, type Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { getEventCoverage, insertEvents } from "../eventStore.ts";
import { collectFilingEvents, type FilingEventsRunResult } from "./eightKEventsRun.ts";
import { labelerChoiceFromArgs } from "./eightKLabelRunner.ts";

/** The two items the fetcher collects; only their labels can produce events. */
const defaultItems = ["2.02", "5.02"];

const filingEventKinds: EventKind[] = [
  "filing_guidance_up",
  "filing_guidance_down",
  "filing_buyback",
  "filing_exec_departure",
];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

export async function runEightKEventsCommand(args: string[]): Promise<void> {
  const { version } = labelerChoiceFromArgs(args);
  const versionsRaw = optionValue(args, "--versions=", version);
  const itemsRaw = optionValue(args, "--items=", defaultItems.join(","));

  const settings = getSettings();
  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const run = await collectFilingEvents({
    labelerVersions: versionsRaw.split(",").map((entry) => entry.trim()),
    items: itemsRaw === "all" ? undefined : itemsRaw.split(",").map((item) => item.trim()),
    onProgress: (message) => console.log(message),
  });

  const insert = insertEvents(db, run.events);
  printReport(db, run, insert.inserted, insert.duplicates, insert.unknown_ticker_rows);
}

function printReport(
  db: Database,
  run: FilingEventsRunResult,
  inserted: number,
  duplicates: number,
  unknownTickerRows: number,
): void {
  console.log(`\nLabeler versions: ${run.labeler_versions.join(", ")}`);
  console.log(
    `Filings: ${run.filings_considered} considered, ${run.filings_labeled} labeled, ` +
      `${run.filings_unlabeled} not yet labeled, ${run.filings_without_ticker} without ticker`,
  );
  console.log(
    `Events: ${inserted} inserted, ${duplicates} duplicates, ` +
      `${unknownTickerRows} outside the candle universe`,
  );
  console.log(
    `Skipped labels: guidance_neutral=${run.skips.guidance_neutral}, ` +
      `exec_departure_routine=${run.skips.exec_departure_routine}`,
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    if (!filingEventKinds.includes(row.event_kind)) {
      continue;
    }
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = filingEventKinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}
