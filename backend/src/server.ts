import { createServer } from "node:http";

import { getSettings } from "./config.ts";
import { createDb, openDatabase } from "./db.ts";
import { parseDatetimeMs, toIsoUtc } from "./datetime.ts";
import { sendJson, sendNoContent, readJson } from "./http.ts";
import { PolygonClient } from "./polygonClient.ts";
import { aggregateHourlyCandles } from "./services/aggregation.ts";
import { syncPolygonCandles, syncYahooCandles } from "./services/candles.ts";
import {
  computeIndicators,
  indicatorCatalog,
  normalizeIndicatorSpecs,
} from "./services/indicators.ts";
import type {
  Candle,
  CandleResponse,
  DeleteSymbolResponse,
  SyncCandlesRequest,
  SymbolResponse,
  SymbolValidationResponse,
} from "./types.ts";
import { parseTimeframe, sourceTimeframe } from "./timeframes.ts";
import type { Timeframe } from "./types.ts";
import { YahooFinanceClient } from "./yahooClient.ts";

const settings = getSettings();
const db = openDatabase(settings.databaseUrl);
createDb(db);
const dayMs = 24 * 60 * 60 * 1000;

function candleResponse(candle: Candle, timeframe: string): CandleResponse {
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

function rowToCandle(row: Record<string, unknown>): Candle {
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

function badRequest(message: string) {
  return { statusCode: 400, body: { detail: message } };
}

function normalizeTicker(tickerPath: string) {
  return decodeURIComponent(tickerPath).toUpperCase().trim();
}

function validateTicker(ticker: string) {
  if (!ticker) {
    return "ticker is required.";
  }
  if (ticker.length > 16) {
    return "ticker must be 16 characters or fewer.";
  }
  return null;
}

function timeframeKey(multiplier: number, timespan: string): string {
  return `${multiplier}${timespan === "hour" ? "h" : "d"}`;
}

function handleListSymbols(): { statusCode: number; body: SymbolResponse[] } {
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

async function handleValidateSymbol(
  tickerPath: string,
): Promise<{ statusCode: number; body: SymbolValidationResponse | { detail: string } }> {
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

function handleDeleteSymbol(
  tickerPath: string,
): { statusCode: number; body: DeleteSymbolResponse | { detail: string } } {
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

function queryCandles(options: {
  ticker: string;
  multiplier: number;
  timespan: string;
  startMs: number;
  endMs: number;
  limit: number;
}): Candle[] {
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

function parseCandleQuery(searchParams: URLSearchParams): {
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

function candlesForTimeframe(options: {
  ticker: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  limit: number;
}): CandleResponse[] {
  if (options.timeframe.key === "1h" || options.timeframe.key === "1d") {
    const rows = queryCandles({
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

  const rows = queryCandles({
    ticker: options.ticker,
    multiplier: sourceTimeframe.multiplier,
    timespan: sourceTimeframe.timespan,
    startMs: options.startMs,
    endMs: options.endMs,
    limit: options.limit,
  });

  return aggregateHourlyCandles(rows, options.timeframe.key);
}

async function handleSync(body: SyncCandlesRequest) {
  if (!body || typeof body !== "object") {
    return badRequest("Request body must be an object.");
  }
  if (typeof body.ticker !== "string" || body.ticker.trim().length === 0) {
    return badRequest("ticker is required.");
  }
  if (body.ticker.trim().length > 16) {
    return badRequest("ticker must be 16 characters or fewer.");
  }
  if (typeof body.start !== "string" || typeof body.end !== "string") {
    return badRequest("start and end are required.");
  }
  const source = body.source ?? "polygon";
  if (source !== "polygon" && source !== "yahoo") {
    return badRequest("source must be polygon or yahoo.");
  }
  if (source === "polygon" && !settings.polygonApiKey) {
    return { statusCode: 500, body: { detail: "POLYGON_API_KEY is not configured." } };
  }

  const ticker = body.ticker.toUpperCase().trim();
  const timeframe = parseTimeframe(body.timeframe ?? "1h");
  const startMs = parseDatetimeMs(body.start);
  const endMs = parseDatetimeMs(body.end);
  const adjusted = body.adjusted ?? true;

  const syncOptions = {
    db,
    ticker,
    timeframe,
    startMs,
    endMs,
    adjusted,
  };
  const result =
    source === "polygon"
      ? await syncPolygonCandles({
          ...syncOptions,
          polygonClient: new PolygonClient(settings.polygonApiKey!, settings.polygonBaseUrl),
        })
      : await syncYahooCandles({
          ...syncOptions,
          yahooClient: new YahooFinanceClient(settings.yahooBaseUrl),
        });

  return {
    statusCode: 200,
    body: {
      ticker,
      source,
      timeframe: timeframe.key,
      requested_start: toIsoUtc(startMs),
      requested_end: toIsoUtc(endMs),
      ...result,
    },
  };
}

function handleListCandles(tickerPath: string, searchParams: URLSearchParams) {
  const ticker = normalizeTicker(tickerPath);
  const query = parseCandleQuery(searchParams);
  const body = candlesForTimeframe({ ticker, ...query });

  return { statusCode: 200, body };
}

function handleListIndicatorCatalog() {
  return { statusCode: 200, body: indicatorCatalog };
}

function handleListIndicators(tickerPath: string, searchParams: URLSearchParams) {
  const ticker = normalizeTicker(tickerPath);
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }

  const rawIndicators = searchParams.get("indicators");
  if (!rawIndicators) {
    return badRequest("indicators query parameter is required.");
  }

  let rawSpecs: unknown;
  try {
    rawSpecs = JSON.parse(rawIndicators);
  } catch {
    return badRequest("indicators must be a JSON array.");
  }

  let specs;
  try {
    specs = normalizeIndicatorSpecs(rawSpecs);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid indicators.");
  }

  const query = parseCandleQuery(searchParams);
  const candles = candlesForTimeframe({ ticker, ...query });
  const body = computeIndicators(candles, specs);
  return { statusCode: 200, body };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/symbols") {
      const result = handleListSymbols();
      sendJson(response, result.statusCode, result.body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/indicators") {
      const result = handleListIndicatorCatalog();
      sendJson(response, result.statusCode, result.body);
      return;
    }

    const symbolValidationMatch = url.pathname.match(/^\/api\/v1\/symbols\/([^/]+)\/validate$/);
    if (request.method === "GET" && symbolValidationMatch) {
      const result = await handleValidateSymbol(symbolValidationMatch[1]);
      sendJson(response, result.statusCode, result.body);
      return;
    }

    const symbolMatch = url.pathname.match(/^\/api\/v1\/symbols\/([^/]+)$/);
    if (request.method === "DELETE" && symbolMatch) {
      const result = handleDeleteSymbol(symbolMatch[1]);
      sendJson(response, result.statusCode, result.body);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/candles/sync") {
      const body = await readJson<SyncCandlesRequest>(request);
      const result = await handleSync(body);
      sendJson(response, result.statusCode, result.body);
      return;
    }

    const candleMatch = url.pathname.match(/^\/api\/v1\/candles\/([^/]+)$/);
    if (request.method === "GET" && candleMatch) {
      const result = handleListCandles(candleMatch[1], url.searchParams);
      sendJson(response, result.statusCode, result.body);
      return;
    }

    const indicatorMatch = url.pathname.match(/^\/api\/v1\/indicators\/([^/]+)$/);
    if (request.method === "GET" && indicatorMatch) {
      const result = handleListIndicators(indicatorMatch[1], url.searchParams);
      sendJson(response, result.statusCode, result.body);
      return;
    }

    sendJson(response, 404, { detail: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const statusCode =
      message.startsWith("Unsupported timeframe") ||
      message.startsWith("Invalid datetime") ||
      message.startsWith("start and end query") ||
      message.startsWith("limit must") ||
      message.startsWith("start must") ||
      message.startsWith("Sync currently") ||
      message.startsWith("Yahoo sync supports")
        ? 400
        : message.startsWith("Polygon request failed") ||
            message.startsWith("Yahoo Finance request failed")
          ? 502
          : 500;
    sendJson(response, statusCode, { detail: message });
  }
});

server.listen(settings.port, "127.0.0.1", () => {
  console.log(`Geridon API listening on http://127.0.0.1:${settings.port}`);
});
