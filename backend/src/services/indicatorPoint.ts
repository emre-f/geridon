import { toIsoUtc } from "../datetime.ts";
import type { CandleResponse, IndicatorPointResponse } from "../types.ts";

export type IndicatorCandle = Pick<
  CandleResponse,
  "timestamp_ms" | "open" | "high" | "low" | "close" | "volume"
>;

export function point(
  timestampMs: number,
  values: Record<string, number | null>,
): IndicatorPointResponse {
  return {
    timestamp_ms: timestampMs,
    timestamp: toIsoUtc(timestampMs),
    values,
  };
}

export function rounded(value: number | null) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(6));
}
