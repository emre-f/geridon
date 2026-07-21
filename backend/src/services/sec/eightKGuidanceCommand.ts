import { getSettings } from "../../config.ts";
import { createDb, openDatabase, type Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { getEventCoverage, insertEvents } from "../eventStore.ts";
import { collectGuidanceEvents, type GuidanceEventsRunResult } from "./eightKGuidanceRun.ts";
import { labelerChoiceFromArgs } from "./eightKLabelRunner.ts";

/** Guidance ships in the item 2.02 press release; 5.02 departures carry none. */
const defaultItems = ["2.02"];

const guidanceEventKinds: EventKind[] = ["guidance_raise", "guidance_cut"];

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

export async function runEightKGuidanceCommand(args: string[]): Promise<void> {
  const { version } = labelerChoiceFromArgs(args);
  const itemsRaw = optionValue(args, "--items=", defaultItems.join(","));

  const settings = getSettings();
  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const run = await collectGuidanceEvents({
    labelerVersion: version,
    items: itemsRaw === "all" ? undefined : itemsRaw.split(",").map((item) => item.trim()),
    onProgress: (message) => console.log(message),
  });

  const insert = insertEvents(db, run.events);
  printReport(db, run, insert.inserted, insert.duplicates, insert.unknown_ticker_rows);
}

function printReport(
  db: Database,
  run: GuidanceEventsRunResult,
  inserted: number,
  duplicates: number,
  unknownTickerRows: number,
): void {
  console.log(`\nLabeler version: ${run.labeler_version}`);
  console.log(
    `Filings: ${run.filings_considered} considered, ${run.filings_labeled} labeled, ` +
      `${run.filings_with_guidance} with guidance, ${run.filings_unlabeled} not yet labeled, ` +
      `${run.filings_without_ticker} without ticker`,
  );
  console.log(
    `Events: ${inserted} inserted, ${duplicates} duplicates, ` +
      `${unknownTickerRows} outside the candle universe`,
  );
  console.log(
    `Skipped figures: initiation=${run.skips.initiation}, reaffirmation=${run.skips.reaffirmation}, ` +
      `withdrawal_no_prior=${run.skips.withdrawal_no_prior}, incomparable=${run.skips.incomparable}`,
  );

  const byYear = new Map<number, Partial<Record<EventKind, number>>>();
  for (const row of getEventCoverage(db)) {
    if (!guidanceEventKinds.includes(row.event_kind)) {
      continue;
    }
    const kinds = byYear.get(row.year) ?? {};
    kinds[row.event_kind] = row.events;
    byYear.set(row.year, kinds);
  }
  console.log("\nEvents per year:");
  for (const [year, kinds] of [...byYear.entries()].sort((left, right) => left[0] - right[0])) {
    const parts = guidanceEventKinds.map((kind) => `${kind}=${kinds[kind] ?? 0}`);
    console.log(`  ${year}  ${parts.join("  ")}`);
  }
}
