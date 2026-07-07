import type { Database } from "../db.ts";
import { parseDatetimeMs, toIsoUtc } from "../datetime.ts";
import { aggregateHourlyCandles } from "../services/aggregation.ts";
import { parseTimeframe, sourceTimeframe } from "../timeframes.ts";
import type { Candle, CandleResponse, Timeframe } from "../types.ts";

export interface ApiResult<T = unknown> {
  statusCode: number;
  body: T;
}

export const dayMs = 24 * 60 * 60 * 1000;

export function candleResponse(candle: Candle, timeframe: string): CandleResponse {
  return {
    ticker: candle.ticker,
    timeframe,
    timestamp_ms: candle.timestamp_ms,
    timestamp: toIsoUtc(candle.timestamp_ms),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    vwap: candle.vwap,
    transactions: candle.transactions,
  };
}

export function rowToCandle(row: Record<string, unknown>): Candle {
  return {
    id: Number(row.id),
    ticker: String(row.ticker),
    multiplier: Number(row.multiplier),
    timespan: String(row.timespan),
    timestamp_ms: Number(row.timestamp_ms),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    vwap: row.vwap == null ? null : Number(row.vwap),
    transactions: row.transactions == null ? null : Number(row.transactions),
    source: String(row.source),
    created_at: String(row.created_at),
  };
}

export function badRequest(message: string) {
  return { statusCode: 400, body: { detail: message } };
}

export function normalizeTicker(tickerPath: string) {
  return decodeURIComponent(tickerPath).toUpperCase().trim();
}

export function validateTicker(ticker: string) {
  if (!ticker) {
    return "ticker is required.";
  }
  if (ticker.length > 16) {
    return "ticker must be 16 characters or fewer.";
  }
  return null;
}

export function timeframeKey(multiplier: number, timespan: string): string {
  return `${multiplier}${timespan === "hour" ? "h" : "d"}`;
}

export function parsePositiveId(idPath: string) {
  const id = Number(idPath);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function queryCandles(
  db: Database,
  options: {
    ticker: string;
    multiplier: number;
    timespan: string;
    startMs: number;
    endMs: number;
    limit: number;
  },
): Candle[] {
  return db
    .prepare(
      `
      SELECT *
      FROM candles
      WHERE ticker = ?
        AND multiplier = ?
        AND timespan = ?
        AND timestamp_ms >= ?
        AND timestamp_ms <= ?
      ORDER BY timestamp_ms ASC
      LIMIT ?
    `,
    )
    .all(
      options.ticker,
      options.multiplier,
      options.timespan,
      options.startMs,
      options.endMs,
      options.limit,
    )
    .map(rowToCandle);
}

export function parseCandleQuery(searchParams: URLSearchParams): {
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  limit: number;
} {
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    throw new Error("start and end query parameters are required.");
  }

  const timeframe = parseTimeframe(searchParams.get("timeframe") ?? "1h");
  const startMs = parseDatetimeMs(start);
  const endMs = parseDatetimeMs(end);
  const limit = Number(searchParams.get("limit") ?? 5000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50_000) {
    throw new Error("limit must be an integer between 1 and 50000.");
  }

  return { timeframe, startMs, endMs, limit };
}

export function candlesForTimeframe(
  db: Database,
  options: {
    ticker: string;
    timeframe: Timeframe;
    startMs: number;
    endMs: number;
    limit: number;
  },
): CandleResponse[] {
  if (options.timeframe.key === "1h" || options.timeframe.key === "1d") {
    const rows = queryCandles(db, {
      ticker: options.ticker,
      multiplier: options.timeframe.multiplier,
      timespan: options.timeframe.timespan,
      startMs: options.startMs,
      endMs: options.endMs,
      limit: options.limit,
    });

    if (options.timeframe.key === "1h" || rows.length > 0) {
      return rows.map((row) => candleResponse(row, options.timeframe.key));
    }
  }

  const rows = queryCandles(db, {
    ticker: options.ticker,
    multiplier: sourceTimeframe.multiplier,
    timespan: sourceTimeframe.timespan,
    startMs: options.startMs,
    endMs: options.endMs,
    limit: options.limit,
  });

  return aggregateHourlyCandles(rows, options.timeframe.key);
}

export function responseToCandle(candle: CandleResponse): Candle {
  const timeframe = parseTimeframe(candle.timeframe);
  return {
    ticker: candle.ticker,
    multiplier: timeframe.multiplier,
    timespan: timeframe.timespan,
    timestamp_ms: candle.timestamp_ms,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    vwap: candle.vwap,
    transactions: candle.transactions,
  };
}
