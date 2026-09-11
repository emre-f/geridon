import { join } from "node:path";

import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { insertEvents } from "../eventStore.ts";
import { ensureCached } from "./cacheFile.ts";
import type { ManagerFiling } from "./edgarClient.ts";
import {
  buildQuarterManifest,
  quarterBoundsMs,
  quarterLabel,
  type Quarter,
  type QuarterManifestEntry,
} from "./filingManifest.ts";
import type { FilingHoldings } from "./infotableParse.ts";
import {
  diffManagerQuarter,
  emptyThirteenFSkipCounts,
  type ThirteenFSkipCounts,
} from "./thirteenFNormalize.ts";

export interface ThirteenFQuarterSummary {
  quarter: string;
  status: "completed" | "already_ingested";
  managers_filed: number;
  managers_without_filing: number;
  managers_without_prior: number;
  amendments_ignored: number;
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
  unmapped_cusips: number;
  skips: ThirteenFSkipCounts;
}

export function emptySummary(quarter: string): ThirteenFQuarterSummary {
  return {
    quarter,
    status: "completed",
    managers_filed: 0,
    managers_without_filing: 0,
    managers_without_prior: 0,
    amendments_ignored: 0,
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
    unmapped_cusips: 0,
    skips: emptyThirteenFSkipCounts(),
  };
}

export function isQuarterIngested(db: Database, quarter: Quarter): boolean {
  const { startMs, endMs } = quarterBoundsMs(quarter);
  const row = db
    .prepare(`
      SELECT id FROM event_ingestions
      WHERE source = 'sec_13f' AND start_ms = ? AND end_ms = ? AND status = 'completed'
    `)
    .get(startMs, endMs);
  return row != null;
}

export interface QuarterContext {
  cacheDir: string;
  knownTickers: Set<string>;
  discover: (cik: number) => Promise<ManagerFiling[]>;
  getHoldings: (cik: number, filing: ManagerFiling) => Promise<FilingHoldings>;
  getCusipMap: () => Promise<Map<string, string>>;
  notify: (message: string) => void;
}

export async function ingestQuarter(
  db: Database,
  quarter: Quarter,
  context: QuarterContext,
): Promise<ThirteenFQuarterSummary> {
  const label = quarterLabel(quarter);
  const { startMs, endMs } = quarterBoundsMs(quarter);
  const ingestionId = Number(
    db
      .prepare("INSERT INTO event_ingestions (source, start_ms, end_ms) VALUES ('sec_13f', ?, ?)")
      .run(startMs, endMs).lastInsertRowid,
  );

  try {
    const manifestJson = await ensureCached(
      join(context.cacheDir, "manifests", `${label}.json`),
      async () => {
        context.notify(`${label}: discovering filings`);
        return JSON.stringify(await buildQuarterManifest(context.discover, quarter));
      },
    );
    const manifest = JSON.parse(manifestJson) as QuarterManifestEntry[];

    const summary = emptySummary(label);
    const unmappedCusips = new Set<string>();
    const batch: EventRecord[] = [];
    for (const entry of manifest) {
      summary.amendments_ignored += entry.amendments;
      if (entry.current == null) {
        summary.managers_without_filing += 1;
        continue;
      }
      summary.managers_filed += 1;
      if (entry.prior == null) {
        summary.managers_without_prior += 1;
        continue;
      }
      const diff = diffManagerQuarter({
        manager: { cik: entry.cik, name: entry.name },
        current: {
          filing: entry.current,
          holdings: await context.getHoldings(entry.cik, entry.current),
        },
        prior: {
          filing: entry.prior,
          holdings: await context.getHoldings(entry.cik, entry.prior),
        },
        cusipToTicker: await context.getCusipMap(),
      });
      batch.push(...diff.events);
      for (const cusip of diff.unmapped_cusips) {
        unmappedCusips.add(cusip);
      }
      for (const reason of Object.keys(summary.skips) as Array<keyof ThirteenFSkipCounts>) {
        summary.skips[reason] += diff.skips[reason];
      }
    }

    const result = insertEvents(db, batch, { knownTickers: context.knownTickers });
    summary.inserted = result.inserted;
    summary.duplicates = result.duplicates;
    summary.unknown_ticker_rows = result.unknown_ticker_rows;
    summary.unknown_tickers = [...result.unknown_tickers].sort();
    summary.unmapped_cusips = unmappedCusips.size;

    const skippedRows =
      summary.unknown_ticker_rows +
      Object.values(summary.skips).reduce((total, count) => total + count, 0);
    db.prepare(`
      UPDATE event_ingestions
      SET status = 'completed', inserted_rows = ?, skipped_rows = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.inserted, skippedRows, ingestionId);
    context.notify(
      `${label}: ${summary.inserted} events inserted, ${summary.duplicates} duplicates, ` +
        `${summary.managers_filed} managers filed`,
    );
    return summary;
  } catch (error) {
    db.prepare(`
      UPDATE event_ingestions
      SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error instanceof Error ? error.message : String(error), ingestionId);
    throw error;
  }
}
