import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { getKnownTickers, insertEvents } from "../eventStore.ts";
import { createEfdClient, type EfdClient, type EfdSearchRow } from "./efdClient.ts";
import { emptyCongressSkipCounts, normalizePtrTransaction, type CongressSkipCounts } from "./ptrNormalize.ts";
import { parsePtrTransactions, parseSearchRow, type PtrFiling } from "./ptrParse.ts";

/** Senate eFD electronic filing goes back to 2012; everything before is paper. */
export const firstSenateEfdYear = 2012;
const insertBatchSize = 500;

export function yearBoundsMs(year: number): { startMs: number; endMs: number } {
  return { startMs: Date.UTC(year, 0, 1), endMs: Date.UTC(year + 1, 0, 1) - 1 };
}

/** Only years fully ended before nowMs; a running year is never cached as done. */
export function yearsInRange(fromYear: number, toYear: number, nowMs: number): number[] {
  const years: number[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    if (yearBoundsMs(year).endMs < nowMs) {
      years.push(year);
    }
  }
  return years;
}

export interface CongressYearSummary {
  year: number;
  status: "completed" | "already_ingested";
  filings: number;
  electronic_filings: number;
  paper_filings: number;
  amendment_filings: number;
  malformed_search_rows: number;
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
  skips: CongressSkipCounts;
}

export interface CongressIngestOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  cacheDir?: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
  /** Tests never provide one and never hit the network: the cache is the fixture. */
  createClient?: () => EfdClient;
}

export async function ingestSenatePtrs(
  options: CongressIngestOptions,
): Promise<CongressYearSummary[]> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/congress");
  const notify = options.onProgress ?? (() => {});
  const knownTickers = getKnownTickers(options.db);

  let client: EfdClient | null = null;
  const getClient = () => (client ??= (options.createClient ?? createEfdClient)());

  const summaries: CongressYearSummary[] = [];
  for (const year of yearsInRange(options.fromYear, options.toYear, options.nowMs ?? Date.now())) {
    if (isYearIngested(options.db, year)) {
      notify(`${year}: already ingested, skipping`);
      summaries.push({ ...emptySummary(year), status: "already_ingested" });
      continue;
    }
    summaries.push(await ingestYear(options.db, year, cacheDir, knownTickers, getClient, notify));
  }
  return summaries;
}

function emptySummary(year: number): CongressYearSummary {
  return {
    year,
    status: "completed",
    filings: 0,
    electronic_filings: 0,
    paper_filings: 0,
    amendment_filings: 0,
    malformed_search_rows: 0,
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
    skips: emptyCongressSkipCounts(),
  };
}

function isYearIngested(db: Database, year: number): boolean {
  const { startMs, endMs } = yearBoundsMs(year);
  const row = db
    .prepare(`
      SELECT id FROM event_ingestions
      WHERE source = 'senate_efd' AND start_ms = ? AND end_ms = ? AND status = 'completed'
    `)
    .get(startMs, endMs);
  return row != null;
}

/** Cached files are the unit of work; a cache hit never touches the network. */
async function ensureCached(
  path: string,
  fetchContent: () => Promise<string>,
): Promise<string> {
  if (existsSync(path)) {
    return readFile(path, "utf8");
  }
  const content = await fetchContent();
  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, content);
  await rename(partialPath, path);
  return content;
}

async function ingestYear(
  db: Database,
  year: number,
  cacheDir: string,
  knownTickers: Set<string>,
  getClient: () => EfdClient,
  notify: (message: string) => void,
): Promise<CongressYearSummary> {
  const { startMs, endMs } = yearBoundsMs(year);
  const ingestionId = Number(
    db
      .prepare("INSERT INTO event_ingestions (source, start_ms, end_ms) VALUES ('senate_efd', ?, ?)")
      .run(startMs, endMs).lastInsertRowid,
  );

  try {
    const yearDir = join(cacheDir, "senate", String(year));
    const filingsJson = await ensureCached(join(yearDir, "filings.json"), async () => {
      notify(`${year}: searching PTR filings`);
      return JSON.stringify(await getClient().searchPtrFilings(year));
    });
    const searchRows = JSON.parse(filingsJson) as EfdSearchRow[];

    const summary = emptySummary(year);
    summary.filings = searchRows.length;
    const filings: PtrFiling[] = [];
    for (const row of searchRows) {
      const filing = parseSearchRow(row);
      if (filing == null) {
        summary.malformed_search_rows += 1;
      } else {
        filings.push(filing);
      }
    }
    filings.sort(
      (left, right) =>
        left.filed_date_ms - right.filed_date_ms || left.report_id.localeCompare(right.report_id),
    );

    const unknownTickers = new Set<string>();
    let batch: EventRecord[] = [];
    const flush = () => {
      if (batch.length === 0) {
        return;
      }
      const result = insertEvents(db, batch, { knownTickers });
      summary.inserted += result.inserted;
      summary.duplicates += result.duplicates;
      summary.unknown_ticker_rows += result.unknown_ticker_rows;
      for (const ticker of result.unknown_tickers) {
        unknownTickers.add(ticker);
      }
      batch = [];
    };

    for (const filing of filings) {
      if (filing.amendment) {
        summary.amendment_filings += 1;
      }
      if (!filing.electronic) {
        summary.paper_filings += 1;
        continue;
      }
      summary.electronic_filings += 1;
      const html = await ensureCached(
        join(yearDir, "ptr", `${filing.report_id}.html`),
        () => {
          notify(`${year}: fetching PTR ${filing.report_id}`);
          return getClient().fetchReportHtml(filing.path);
        },
      );
      for (const row of parsePtrTransactions(html)) {
        const result = normalizePtrTransaction(filing, row);
        if ("skip" in result) {
          summary.skips[result.skip] += 1;
          continue;
        }
        batch.push(result.event);
        if (batch.length >= insertBatchSize) {
          flush();
        }
      }
    }
    flush();
    summary.unknown_tickers = [...unknownTickers].sort();

    const skippedRows =
      summary.unknown_ticker_rows +
      Object.values(summary.skips).reduce((total, count) => total + count, 0);
    db.prepare(`
      UPDATE event_ingestions
      SET status = 'completed', inserted_rows = ?, skipped_rows = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.inserted, skippedRows, ingestionId);
    notify(
      `${year}: ${summary.inserted} events inserted, ${summary.duplicates} duplicates, ` +
        `${summary.paper_filings} paper filings uningestable`,
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
