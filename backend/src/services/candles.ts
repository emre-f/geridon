import type { Database } from "../db.ts";
import { PolygonClient } from "../polygonClient.ts";
import type { MarketDataCandle, Timeframe } from "../types.ts";
import { YahooFinanceClient } from "../yahooClient.ts";
import { getMissingRanges, type Range } from "./coverage.ts";
import { sourceTimeframe } from "../timeframes.ts";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

export interface SyncResult {
  fetched_ranges: number;
  candles_received: number;
  candles_inserted: number;
  candles_skipped: number;
}

export function chunkRange(startMs: number, endMs: number, timespan: string): Range[] {
  const chunkSize = timespan === "hour" ? 180 * dayMs : 5 * 365 * dayMs;
  const chunks: Range[] = [];
  let cursor = startMs;

  while (cursor <= endMs) {
    const chunkEnd = Math.min(cursor + chunkSize - 1, endMs);
    chunks.push([cursor, chunkEnd]);
    cursor = chunkEnd + 1;
  }

  return chunks;
}

export async function syncCandlesFromProvider(options: {
  db: Database;
  ticker: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  source: string;
  fetchCandles: (range: Range) => Promise<MarketDataCandle[]>;
}): Promise<SyncResult> {
  if (options.startMs > options.endMs) {
    throw new Error("start must be before or equal to end.");
  }

  const ticker = options.ticker.toUpperCase().trim();
  const missingRanges = getMissingRanges({
    db: options.db,
    ticker,
    multiplier: options.timeframe.multiplier,
    timespan: options.timeframe.timespan,
    source: options.source,
    startMs: options.startMs,
    endMs: options.endMs,
  });

  let fetchedRanges = 0;
  let candlesReceived = 0;
  let candlesInserted = 0;
  let candlesSkipped = 0;

  const insertCandle = options.db.prepare(`
    INSERT OR IGNORE INTO candles (
      ticker, multiplier, timespan, timestamp_ms,
      open, high, low, close, volume, vwap, transactions, source, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const insertFetchRange = options.db.prepare(`
    INSERT INTO fetch_ranges (
      ticker, multiplier, timespan, start_ms, end_ms, source, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'success', CURRENT_TIMESTAMP)
  `);

  for (const [missingStart, missingEnd] of missingRanges) {
    for (const [chunkStart, chunkEnd] of chunkRange(
      missingStart,
      missingEnd,
      options.timeframe.timespan,
    )) {
      const candles = await options.fetchCandles([chunkStart, chunkEnd]);

      fetchedRanges += 1;
      candlesReceived += candles.length;

      // Record coverage even for empty chunks (weekends, pre-inception ranges)
      // so they are not re-fetched on every sync.
      options.db.exec("BEGIN");
      try {
        for (const candle of candles) {
          const result = insertCandle.run(
            ticker,
            options.timeframe.multiplier,
            options.timeframe.timespan,
            candle.timestamp_ms,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
            candle.vwap,
            candle.transactions,
            options.source,
          );

          if (result.changes === 1) {
            candlesInserted += 1;
          } else {
            candlesSkipped += 1;
          }
        }

        insertFetchRange.run(
          ticker,
          options.timeframe.multiplier,
          options.timeframe.timespan,
          chunkStart,
          chunkEnd,
          options.source,
        );
        options.db.exec("COMMIT");
      } catch (error) {
        options.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  return {
    fetched_ranges: fetchedRanges,
    candles_received: candlesReceived,
    candles_inserted: candlesInserted,
    candles_skipped: candlesSkipped,
  };
}

export async function syncPolygonCandles(options: {
  db: Database;
  polygonClient: PolygonClient;
  ticker: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  adjusted: boolean;
}): Promise<SyncResult> {
  if (options.timeframe.key !== sourceTimeframe.key) {
    throw new Error("Sync currently supports 1h candles as the source timeframe.");
  }
  const ticker = options.ticker.toUpperCase().trim();

  return syncCandlesFromProvider({
    db: options.db,
    ticker,
    timeframe: options.timeframe,
    startMs: options.startMs,
    endMs: options.endMs,
    source: "polygon",
    fetchCandles: ([chunkStart, chunkEnd]) =>
      options.polygonClient.getAggregates({
        ticker,
        multiplier: options.timeframe.multiplier,
        timespan: options.timeframe.timespan,
        startMs: chunkStart,
        endMs: chunkEnd,
        adjusted: options.adjusted,
      }),
  });
}

export async function syncYahooCandles(options: {
  db: Database;
  yahooClient: YahooFinanceClient;
  ticker: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  adjusted: boolean;
}): Promise<SyncResult> {
  if (options.timeframe.key !== "1h" && options.timeframe.key !== "1d") {
    throw new Error("Yahoo sync supports 1h and 1d candles. Use stored 1h candles for 4h views.");
  }

  const ticker = options.ticker.toUpperCase().trim();
  return syncCandlesFromProvider({
    db: options.db,
    ticker,
    timeframe: options.timeframe,
    startMs: options.startMs,
    endMs: options.endMs,
    source: "yahoo",
    fetchCandles: ([chunkStart, chunkEnd]) =>
      options.yahooClient.getCandles({
        ticker,
        timeframe: options.timeframe,
        startMs: chunkStart,
        endMs: chunkEnd,
        adjusted: options.adjusted,
      }),
  });
}
