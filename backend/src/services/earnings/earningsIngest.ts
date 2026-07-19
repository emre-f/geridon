import { resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { getKnownTickers, insertEvents } from "../eventStore.ts";
import {
  ensureDayData,
  monthBoundsMs,
  monthLabel,
  monthsInRange,
  weekdayDatesInMonth,
  type Month,
} from "./earningsCalendar.ts";
import {
  emptyEarningsSkipCounts,
  normalizeEarningsRow,
  type EarningsSkipCounts,
} from "./earningsNormalize.ts";

const defaultFetchDelayMs = 300;

export interface EarningsMonthSummary {
  month: string;
  status: "completed" | "already_ingested";
  inserted: number;
  duplicates: number;
  unknown_ticker_rows: number;
  unknown_tickers: string[];
  skips: EarningsSkipCounts;
}

export interface EarningsIngestOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  cacheDir?: string;
  baseUrl?: string;
  nowMs?: number;
  fetchDelayMs?: number;
  onProgress?: (message: string) => void;
}

export async function ingestEarnings(
  options: EarningsIngestOptions,
): Promise<EarningsMonthSummary[]> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/nasdaq_earnings");
  const notify = options.onProgress ?? (() => {});
  const knownTickers = getKnownTickers(options.db);
  const priorCloseAt = makePriorCloseLookup(options.db);

  const summaries: EarningsMonthSummary[] = [];
  for (const month of monthsInRange(options.fromYear, options.toYear, options.nowMs ?? Date.now())) {
    const label = monthLabel(month);
    if (isMonthIngested(options.db, month)) {
      notify(`${label}: already ingested, skipping`);
      summaries.push({ ...emptySummary(label), status: "already_ingested" });
      continue;
    }
    summaries.push(
      await ingestMonth(options, month, cacheDir, knownTickers, priorCloseAt, notify),
    );
  }
  return summaries;
}

function emptySummary(month: string): EarningsMonthSummary {
  return {
    month,
    status: "completed",
    inserted: 0,
    duplicates: 0,
    unknown_ticker_rows: 0,
    unknown_tickers: [],
    skips: emptyEarningsSkipCounts(),
  };
}

function isMonthIngested(db: Database, month: Month): boolean {
  const { startMs, endMs } = monthBoundsMs(month);
  const row = db
    .prepare(`
      SELECT id FROM event_ingestions
      WHERE source = 'nasdaq_earnings' AND start_ms = ? AND end_ms = ? AND status = 'completed'
    `)
    .get(startMs, endMs);
  return row != null;
}

function makePriorCloseLookup(db: Database): (ticker: string, atMs: number) => number | null {
  const query = db.prepare(`
    SELECT close FROM candles
    WHERE ticker = ? AND multiplier = 1 AND timespan = 'day' AND timestamp_ms <= ?
    ORDER BY timestamp_ms DESC LIMIT 1
  `);
  return (ticker, atMs) => {
    const row = query.get(ticker, atMs);
    return row == null ? null : Number(row.close);
  };
}

async function ingestMonth(
  options: EarningsIngestOptions,
  month: Month,
  cacheDir: string,
  knownTickers: Set<string>,
  priorCloseAt: (ticker: string, atMs: number) => number | null,
  notify: (message: string) => void,
): Promise<EarningsMonthSummary> {
  const label = monthLabel(month);
  const { startMs, endMs } = monthBoundsMs(month);
  const db = options.db;
  const ingestionId = Number(
    db
      .prepare(
        "INSERT INTO event_ingestions (source, start_ms, end_ms) VALUES ('nasdaq_earnings', ?, ?)",
      )
      .run(startMs, endMs).lastInsertRowid,
  );

  try {
    const summary = emptySummary(label);
    const unknownTickers = new Set<string>();
    const events: EventRecord[] = [];

    for (const dateIso of weekdayDatesInMonth(month)) {
      const day = await ensureDayData(dateIso, cacheDir, options.baseUrl);
      for (const row of day.rows) {
        const symbol = row.symbol?.toUpperCase().trim() ?? "";
        if (symbol && !knownTickers.has(symbol)) {
          summary.unknown_ticker_rows += 1;
          unknownTickers.add(symbol);
          continue;
        }
        const result = normalizeEarningsRow(row, dateIso, priorCloseAt);
        if ("skip" in result) {
          summary.skips[result.skip] += 1;
          continue;
        }
        events.push(result.event);
      }
      if (day.fetched) {
        await sleep(options.fetchDelayMs ?? defaultFetchDelayMs);
      }
    }

    const result = insertEvents(db, events, { knownTickers });
    summary.inserted = result.inserted;
    summary.duplicates = result.duplicates;
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
      `${label}: ${summary.inserted} events inserted, ${summary.duplicates} duplicates, ${skippedRows} rows skipped`,
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
}
