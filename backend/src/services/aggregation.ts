import { toIsoUtc } from "../datetime.ts";
import type { Candle, CandleResponse } from "../types.ts";

const marketTimeZone = "America/New_York";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface MutableAggregate {
  ticker: string;
  timeframe: string;
  timestamp_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  weightedVwapSum: number;
  transactions: number | null;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: marketTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(timestampMs: number): ZonedParts {
  const parts = formatter.formatToParts(new Date(timestampMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function timezoneOffsetMs(timestampMs: number): number {
  const parts = zonedParts(timestampMs);
  const samePartsAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return samePartsAsUtc - timestampMs;
}

function zonedLocalToUtcMs(parts: ZonedParts): number {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const firstPass = guess - timezoneOffsetMs(guess);
  const secondPass = guess - timezoneOffsetMs(firstPass);
  return secondPass;
}

export function bucketTimestampMs(timestampMs: number, timeframe: string): number {
  const parts = zonedParts(timestampMs);

  if (timeframe === "4h") {
    return zonedLocalToUtcMs({
      ...parts,
      hour: Math.floor(parts.hour / 4) * 4,
      minute: 0,
      second: 0,
    });
  }

  if (timeframe === "1d") {
    return zonedLocalToUtcMs({
      ...parts,
      hour: 0,
      minute: 0,
      second: 0,
    });
  }

  throw new Error(`Cannot aggregate timeframe '${timeframe}'.`);
}

function toResponse(aggregate: MutableAggregate): CandleResponse {
  return {
    ticker: aggregate.ticker,
    timeframe: aggregate.timeframe,
    timestamp_ms: aggregate.timestamp_ms,
    timestamp: toIsoUtc(aggregate.timestamp_ms),
    open: aggregate.open,
    high: aggregate.high,
    low: aggregate.low,
    close: aggregate.close,
    volume: aggregate.volume,
    vwap: aggregate.volume ? aggregate.weightedVwapSum / aggregate.volume : null,
    transactions: aggregate.transactions,
  };
}

export function aggregateHourlyCandles(candles: Candle[], timeframe: string): CandleResponse[] {
  const grouped = new Map<number, MutableAggregate>();

  for (const candle of candles) {
    const bucketMs = bucketTimestampMs(candle.timestamp_ms, timeframe);
    const existing = grouped.get(bucketMs);

    if (!existing) {
      grouped.set(bucketMs, {
        ticker: candle.ticker,
        timeframe,
        timestamp_ms: bucketMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        weightedVwapSum: (candle.vwap ?? 0) * candle.volume,
        transactions: candle.transactions,
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
    if (candle.vwap != null) {
      existing.weightedVwapSum += candle.vwap * candle.volume;
    }
    if (candle.transactions != null) {
      existing.transactions = (existing.transactions ?? 0) + candle.transactions;
    }
  }

  return [...grouped.keys()].sort((a, b) => a - b).map((key) => toResponse(grouped.get(key)!));
}
