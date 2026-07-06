import type { MarketDataCandle, Timeframe } from "./types.ts";

interface YahooQuote {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

interface YahooAdjClose {
  adjclose?: Array<number | null>;
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuote[];
    adjclose?: YahooAdjClose[];
  };
}

interface YahooChartPayload {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dailyTimestampMs(timestampSec: number): number {
  const date = new Date(timestampSec * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function yahooInterval(timeframe: Timeframe): string {
  if (timeframe.key === "1h") {
    return "1h";
  }
  if (timeframe.key === "1d") {
    return "1d";
  }
  throw new Error("Yahoo sync supports 1h and 1d candles. Use stored 1h candles for 4h views.");
}

export function normalizeYahooChartResult(
  result: YahooChartResult,
  timeframe: Timeframe,
  adjusted: boolean,
): MarketDataCandle[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose;
  const candles: MarketDataCandle[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSec = timestamps[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];

    if (
      !isFiniteNumber(timestampSec) ||
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      !isFiniteNumber(volume)
    ) {
      continue;
    }

    const adjClose = adjclose?.[index];
    const ratio =
      adjusted && isFiniteNumber(adjClose) && close !== 0 ? adjClose / close : 1;

    candles.push({
      timestamp_ms:
        timeframe.key === "1d" ? dailyTimestampMs(timestampSec) : timestampSec * 1000,
      open: open * ratio,
      high: high * ratio,
      low: low * ratio,
      close: close * ratio,
      volume,
      vwap: null,
      transactions: null,
    });
  }

  return candles.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
}

export class YahooFinanceClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://query1.finance.yahoo.com") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async getCandles(options: {
    ticker: string;
    timeframe: Timeframe;
    startMs: number;
    endMs: number;
    adjusted: boolean;
  }): Promise<MarketDataCandle[]> {
    const interval = yahooInterval(options.timeframe);
    const url = new URL(
      `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(options.ticker)}`,
    );
    url.searchParams.set("period1", String(Math.floor(options.startMs / 1000)));
    url.searchParams.set("period2", String(Math.ceil(options.endMs / 1000) + 1));
    url.searchParams.set("interval", interval);
    url.searchParams.set("events", "history");
    url.searchParams.set("includePrePost", "false");

    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

    let payload: YahooChartPayload | null = null;
    try {
      payload = (await response.json()) as YahooChartPayload;
    } catch {
      payload = null;
    }
    const description =
      payload?.chart?.error?.description ?? payload?.chart?.error?.code ?? null;

    // Yahoo rejects ranges that end before the ticker's first trade with an
    // HTTP 400 instead of an empty result; treat that as "no data".
    if (response.status === 400 && description?.includes("Data doesn't exist")) {
      return [];
    }
    if (!response.ok) {
      throw new Error(
        `Yahoo Finance request failed with HTTP ${response.status}${description ? `: ${description}` : ""}.`,
      );
    }
    if (payload?.chart?.error) {
      throw new Error(`Yahoo Finance request failed: ${description ?? "unknown error"}.`);
    }

    const result = payload?.chart?.result?.[0];
    if (!result) {
      return [];
    }

    return normalizeYahooChartResult(result, options.timeframe, options.adjusted);
  }
}
