import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { getKnownTickers, insertEvents } from "../eventStore.ts";
import {
  buildOwnerIndex,
  buildSubmissionIndex,
  emptySkipCounts,
  normalizeTransaction,
  type Form4SkipCounts,
} from "./form4Normalize.ts";
import { readTsvRecords } from "./secTsv.ts";

const execFileAsync = promisify(execFile);

const secBaseUrl =
  "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets";
const requiredTsvFiles = ["SUBMISSION.tsv", "REPORTINGOWNER.tsv", "NONDERIV_TRANS.tsv"];
const insertBatchSize = 2_000;

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

/** Quarters from fromYear q1 through the last quarter fully ended before nowMs. */
export function quartersInRange(fromYear: number, toYear: number, nowMs: number): Quarter[] {
  const quarters: Quarter[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      if (quarterBoundsMs({ year, quarter }).endMs < nowMs) {
        quarters.push({ year, quarter });
      }
    }
  }
  return quarters;
}

export interface Form4QuarterSummary {
  quarter: string;
  status: "completed" | "already_ingested" | "unpublished";
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
  skips: Form4SkipCounts;
}

export interface Form4IngestOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  userAgent: string;
  cacheDir?: string;
  baseUrl?: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
}

export async function ingestForm4(options: Form4IngestOptions): Promise<Form4QuarterSummary[]> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec");
  const baseUrl = options.baseUrl ?? secBaseUrl;
  const notify = options.onProgress ?? (() => {});
  const knownTickers = getKnownTickers(options.db);

  const summaries: Form4QuarterSummary[] = [];
  for (const quarter of quartersInRange(options.fromYear, options.toYear, options.nowMs ?? Date.now())) {
    const label = quarterLabel(quarter);
    if (isQuarterIngested(options.db, quarter)) {
      notify(`${label}: already ingested, skipping`);
      summaries.push({ ...emptySummary(label), status: "already_ingested" });
      continue;
    }

    const extractedDir = await ensureQuarterData(label, cacheDir, baseUrl, options.userAgent, notify);
    if (extractedDir == null) {
      notify(`${label}: not published yet, skipping`);
      summaries.push({ ...emptySummary(label), status: "unpublished" });
      continue;
    }

    summaries.push(await ingestQuarter(options.db, quarter, extractedDir, knownTickers, notify));
  }
  return summaries;
}

function emptySummary(quarter: string): Form4QuarterSummary {
  return {
    quarter,
    status: "completed",
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
    skips: emptySkipCounts(),
  };
}

function isQuarterIngested(db: Database, quarter: Quarter): boolean {
  const { startMs, endMs } = quarterBoundsMs(quarter);
  const row = db
    .prepare(`
      SELECT id FROM event_ingestions
      WHERE source = 'sec_form4' AND start_ms = ? AND end_ms = ? AND status = 'completed'
    `)
    .get(startMs, endMs);
  return row != null;
}

/**
 * The extracted TSV directory is the cache unit: if it is complete, neither
 * the network nor the zip is touched again. Zips download to a .partial path
 * first so an interrupted download never poisons the cache.
 */
async function ensureQuarterData(
  label: string,
  cacheDir: string,
  baseUrl: string,
  userAgent: string,
  notify: (message: string) => void,
): Promise<string | null> {
  const extractedDir = join(cacheDir, label);
  if (requiredTsvFiles.every((file) => existsSync(join(extractedDir, file)))) {
    return extractedDir;
  }

  const zipPath = join(cacheDir, `${label}_form345.zip`);
  if (!existsSync(zipPath)) {
    await mkdir(cacheDir, { recursive: true });
    notify(`${label}: downloading ${label}_form345.zip`);
    const response = await fetch(`${baseUrl}/${label}_form345.zip`, {
      headers: { "User-Agent": userAgent },
    });
    if (response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`SEC download failed for ${label}: HTTP ${response.status}`);
    }
    const partialPath = `${zipPath}.partial`;
    await writeFile(partialPath, Buffer.from(await response.arrayBuffer()));
    await rename(partialPath, zipPath);
  }

  await mkdir(extractedDir, { recursive: true });
  await execFileAsync("unzip", ["-o", "-q", zipPath, ...requiredTsvFiles, "-d", extractedDir]);
  return extractedDir;
}

async function ingestQuarter(
  db: Database,
  quarter: Quarter,
  extractedDir: string,
  knownTickers: Set<string>,
  notify: (message: string) => void,
): Promise<Form4QuarterSummary> {
  const label = quarterLabel(quarter);
  const { startMs, endMs } = quarterBoundsMs(quarter);
  const ingestionId = Number(
    db
      .prepare("INSERT INTO event_ingestions (source, start_ms, end_ms) VALUES ('sec_form4', ?, ?)")
      .run(startMs, endMs).lastInsertRowid,
  );

  try {
    const submissions = await buildSubmissionIndex(
      readTsvRecords(join(extractedDir, "SUBMISSION.tsv")),
    );
    const owners = await buildOwnerIndex(
      readTsvRecords(join(extractedDir, "REPORTINGOWNER.tsv")),
    );

    const summary = emptySummary(label);
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

    for await (const row of readTsvRecords(join(extractedDir, "NONDERIV_TRANS.tsv"))) {
      const result = normalizeTransaction(row, submissions, owners);
      if ("skip" in result) {
        summary.skips[result.skip] += 1;
        continue;
      }
      batch.push(result.event);
      if (batch.length >= insertBatchSize) {
        flush();
      }
    }
    flush();
    summary.unknown_tickers = [...unknownTickers].sort();

    const skippedRows =
      summary.unknown_ticker_rows +
      Object.entries(summary.skips)
        .filter(([reason]) => reason !== "non_open_market")
        .reduce((total, [, count]) => total + count, 0);
    db.prepare(`
      UPDATE event_ingestions
      SET status = 'completed', inserted_rows = ?, skipped_rows = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.inserted, skippedRows, ingestionId);
    notify(`${label}: ${summary.inserted} events inserted, ${summary.duplicates} duplicates, ${skippedRows} rows skipped`);
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
