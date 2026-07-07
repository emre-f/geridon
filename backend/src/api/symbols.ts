import type { Settings } from "../config.ts";
import type { Database } from "../db.ts";
import { toIsoUtc } from "../datetime.ts";
import { parseTimeframe } from "../timeframes.ts";
import type {
  DeleteSymbolResponse,
  SymbolResponse,
  SymbolValidationResponse,
} from "../types.ts";
import { YahooFinanceClient } from "../yahooClient.ts";
import {
  badRequest,
  dayMs,
  normalizeTicker,
  timeframeKey,
  validateTicker,
  type ApiResult,
} from "./shared.ts";

export function handleListSymbols(db: Database): ApiResult<SymbolResponse[]> {
  const rows = db
    .prepare(
      `
      SELECT
        ticker,
        multiplier,
        timespan,
        COUNT(*) AS candles,
        MIN(timestamp_ms) AS start_ms,
        MAX(timestamp_ms) AS end_ms
      FROM candles
      GROUP BY ticker, multiplier, timespan
      ORDER BY ticker ASC, timespan ASC, multiplier ASC
    `,
    )
    .all();

  const symbols = new Map<string, SymbolResponse>();

  for (const row of rows) {
    const ticker = String(row.ticker);
    const symbol = symbols.get(ticker) ?? { ticker, timeframes: [] };
    const startMs = Number(row.start_ms);
    const endMs = Number(row.end_ms);

    symbol.timeframes.push({
      timeframe: timeframeKey(Number(row.multiplier), String(row.timespan)),
      candles: Number(row.candles),
      start_ms: startMs,
      start: toIsoUtc(startMs),
      end_ms: endMs,
      end: toIsoUtc(endMs),
    });
    symbols.set(ticker, symbol);
  }

  return { statusCode: 200, body: Array.from(symbols.values()) };
}

export async function handleValidateSymbol(
  db: Database,
  settings: Settings,
  tickerPath: string,
): Promise<ApiResult<SymbolValidationResponse | { detail: string }>> {
  const ticker = normalizeTicker(tickerPath);
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }

  const existing = db
    .prepare("SELECT 1 FROM candles WHERE ticker = ? LIMIT 1")
    .get(ticker);
  if (existing) {
    return { statusCode: 200, body: { ticker, valid: true } };
  }

  try {
    const endMs = Date.now();
    const startMs = endMs - 45 * dayMs;
    const candles = await new YahooFinanceClient(settings.yahooBaseUrl).getCandles({
      ticker,
      timeframe: parseTimeframe("1d"),
      startMs,
      endMs,
      adjusted: true,
    });

    return { statusCode: 200, body: { ticker, valid: candles.length > 0 } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("No data found") || message.includes("not found")) {
      return { statusCode: 200, body: { ticker, valid: false } };
    }
    throw error;
  }
}

export function handleDeleteSymbol(
  db: Database,
  tickerPath: string,
): ApiResult<DeleteSymbolResponse | { detail: string }> {
  const ticker = normalizeTicker(tickerPath);
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }

  db.exec("BEGIN");
  try {
    const fetchRangesDeleted = Number(
      db.prepare("DELETE FROM fetch_ranges WHERE ticker = ?").run(ticker).changes,
    );
    const candlesDeleted = Number(db.prepare("DELETE FROM candles WHERE ticker = ?").run(ticker).changes);
    db.prepare("DELETE FROM chart_states WHERE ticker = ?").run(ticker);
    db.exec("COMMIT");

    if (fetchRangesDeleted + candlesDeleted === 0) {
      return { statusCode: 404, body: { detail: `${ticker} was not found.` } };
    }

    return {
      statusCode: 200,
      body: {
        ticker,
        candles_deleted: candlesDeleted,
        fetch_ranges_deleted: fetchRangesDeleted,
      },
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
