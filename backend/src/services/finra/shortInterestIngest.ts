import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { getKnownTickers, insertEvents } from "../eventStore.ts";
import {
  cycleBoundsMs,
  cycleLabel,
  cycleSettlementCandidatesMs,
  cyclesInRange,
  emptySkipCounts,
  normalizeShortInterestRow,
  parseShortInterestHeader,
  parseShortInterestRow,
  publicationAvailableTsMs,
  type Cycle,
  type ShortInterestSkipCounts,
} from "./shortInterestNormalize.ts";

const finraBaseUrl = "https://cdn.finra.org/equity/otcmarket/biweekly";
const insertBatchSize = 2_000;
const downloadPauseMs = 300;

/** First cycle with a published consolidated file is late December 2017. */
export const firstShortInterestYear = 2018;

export interface ShortInterestCycleSummary {
  cycle: string;
  status: "completed" | "already_ingested" | "unpublished";
  settlement_date: string | null;
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
  skips: ShortInterestSkipCounts;
}

export interface ShortInterestIngestOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  cacheDir?: string;
  baseUrl?: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
}

export async function ingestShortInterest(
  options: ShortInterestIngestOptions,
): Promise<ShortInterestCycleSummary[]> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/finra");
  const baseUrl = options.baseUrl ?? finraBaseUrl;
  const nowMs = options.nowMs ?? Date.now();
  const notify = options.onProgress ?? (() => {});
  const knownTickers = getKnownTickers(options.db);

  const summaries: ShortInterestCycleSummary[] = [];
  for (const cycle of cyclesInRange(options.fromYear, options.toYear, nowMs)) {
    const label = cycleLabel(cycle);
    if (isCycleIngested(options.db, cycle)) {
      notify(`${label}: already ingested, skipping`);
      summaries.push({ ...emptySummary(label), status: "already_ingested" });
      continue;
    }

    const candidates = cycleSettlementCandidatesMs(cycle);
    if (publicationAvailableTsMs(candidates[0]) > nowMs) {
      notify(`${label}: not published yet, skipping`);
      summaries.push({ ...emptySummary(label), status: "unpublished" });
      continue;
    }

    const filePath = await ensureCycleFile(candidates, cacheDir, baseUrl, notify);
    if (filePath == null) {
      notify(`${label}: no file found on FINRA CDN, skipping`);
      summaries.push({ ...emptySummary(label), status: "unpublished" });
      continue;
    }

    summaries.push(await ingestCycle(options.db, cycle, filePath, knownTickers, notify));
  }
  return summaries;
}

function emptySummary(cycle: string): ShortInterestCycleSummary {
  return {
    cycle,
    status: "completed",
    settlement_date: null,
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
    skips: emptySkipCounts(),
  };
}

function isCycleIngested(db: Database, cycle: Cycle): boolean {
  const { startMs, endMs } = cycleBoundsMs(cycle);
  const row = db
    .prepare(`
      SELECT id FROM event_ingestions
      WHERE source = 'finra_short_interest' AND start_ms = ? AND end_ms = ? AND status = 'completed'
    `)
    .get(startMs, endMs);
  return row != null;
}

function fileNameForSettlement(settlementMs: number): string {
  const day = new Date(settlementMs).toISOString().slice(0, 10).replaceAll("-", "");
  return `shrt${day}.csv`;
}

/**
 * The cached file is the cache unit. Missing dates return 403 from the CDN;
 * that means either a holiday-shifted settlement (walk back) or a cycle FINRA
 * has not published, which stays retryable on the next run.
 */
async function ensureCycleFile(
  candidates: number[],
  cacheDir: string,
  baseUrl: string,
  notify: (message: string) => void,
): Promise<string | null> {
  for (const candidate of candidates) {
    const cached = join(cacheDir, fileNameForSettlement(candidate));
    if (existsSync(cached)) {
      return cached;
    }
  }

  await mkdir(cacheDir, { recursive: true });
  for (const candidate of candidates) {
    const fileName = fileNameForSettlement(candidate);
    notify(`downloading ${fileName}`);
    const response = await fetch(`${baseUrl}/${fileName}`);
    await sleep(downloadPauseMs);
    if (response.status === 403 || response.status === 404) {
      continue;
    }
    if (!response.ok) {
      throw new Error(`FINRA download failed for ${fileName}: HTTP ${response.status}`);
    }
    const filePath = join(cacheDir, fileName);
    const partialPath = `${filePath}.partial`;
    await writeFile(partialPath, Buffer.from(await response.arrayBuffer()));
    await rename(partialPath, filePath);
    return filePath;
  }
  return null;
}

async function ingestCycle(
  db: Database,
  cycle: Cycle,
  filePath: string,
  knownTickers: Set<string>,
  notify: (message: string) => void,
): Promise<ShortInterestCycleSummary> {
  const label = cycleLabel(cycle);
  const { startMs, endMs } = cycleBoundsMs(cycle);
  const ingestionId = Number(
    db
      .prepare(
        "INSERT INTO event_ingestions (source, start_ms, end_ms) VALUES ('finra_short_interest', ?, ?)",
      )
      .run(startMs, endMs).lastInsertRowid,
  );

  try {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter((line) => line !== "");
    const header = parseShortInterestHeader(lines[0] ?? "");

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

    for (const line of lines.slice(1)) {
      const result = normalizeShortInterestRow(parseShortInterestRow(header, line));
      if ("skip" in result) {
        summary.skips[result.skip] += 1;
        continue;
      }
      summary.settlement_date ??= result.events[0].payload.settlement_date;
      batch.push(...result.events);
      if (batch.length >= insertBatchSize) {
        flush();
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
      `${label} (settled ${summary.settlement_date ?? "?"}): ${summary.inserted} events inserted, ` +
        `${summary.duplicates} duplicates, ${skippedRows} rows skipped`,
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
