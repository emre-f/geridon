import type { Settings } from "../config.ts";
import type { Database } from "../db.ts";
import { parseDatetimeMs, toIsoUtc } from "../datetime.ts";
import { PolygonClient } from "../polygonClient.ts";
import { syncPolygonCandles, syncYahooCandles } from "../services/candles.ts";
import {
  computeIndicators,
  indicatorCatalog,
  normalizeIndicatorSpecs,
} from "../services/indicators.ts";
import { parseTimeframe } from "../timeframes.ts";
import type { IndicatorSpec, SyncCandlesRequest, SyncCandlesResponse } from "../types.ts";
import { YahooFinanceClient } from "../yahooClient.ts";
import {
  badRequest,
  candlesForTimeframe,
  normalizeTicker,
  parseCandleQuery,
  validateTicker,
  type ApiResult,
} from "./shared.ts";

export async function handleSync(
  db: Database,
  settings: Settings,
  body: SyncCandlesRequest,
): Promise<ApiResult<SyncCandlesResponse | { detail: string }>> {
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

export function handleListCandles(
  db: Database,
  tickerPath: string,
  searchParams: URLSearchParams,
) {
  const ticker = normalizeTicker(tickerPath);
  const query = parseCandleQuery(searchParams);
  const body = candlesForTimeframe(db, { ticker, ...query });

  return { statusCode: 200, body };
}

export function handleListIndicatorCatalog() {
  return { statusCode: 200, body: indicatorCatalog };
}

export function handleListIndicators(
  db: Database,
  tickerPath: string,
  searchParams: URLSearchParams,
) {
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

  let specs: IndicatorSpec[];
  try {
    specs = normalizeIndicatorSpecs(rawSpecs);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid indicators.");
  }

  const query = parseCandleQuery(searchParams);
  const candles = candlesForTimeframe(db, { ticker, ...query });
  const body = computeIndicators(candles, specs);
  return { statusCode: 200, body };
}
