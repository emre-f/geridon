import type { Timeframe } from "./types.ts";

export const supportedTimeframes: Record<string, Timeframe> = {
  "1h": { multiplier: 1, timespan: "hour", key: "1h" },
  "4h": { multiplier: 4, timespan: "hour", key: "4h" },
  "1d": { multiplier: 1, timespan: "day", key: "1d" },
};

export const sourceTimeframe = supportedTimeframes["1h"];

export function parseTimeframe(value: string): Timeframe {
  const timeframe = supportedTimeframes[value.toLowerCase()];
  if (!timeframe) {
    const supported = Object.keys(supportedTimeframes).sort().join(", ");
    throw new Error(`Unsupported timeframe '${value}'. Use one of: ${supported}.`);
  }
  return timeframe;
}
