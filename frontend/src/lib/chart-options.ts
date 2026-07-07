import type { SymbolSummary } from "@/lib/api";

export const chartModeOptions = [
  { value: "line", label: "Line" },
  { value: "candle", label: "Candle" },
];

export const timeframeOptions = [
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

export const rangeOptions = [
  { value: "1M", label: "1M", days: 31 },
  { value: "3M", label: "3M", days: 93 },
  { value: "1Y", label: "1Y", days: 366 },
  { value: "5Y", label: "5Y", days: 366 * 5 },
  { value: "MAX", label: "MAX", days: null },
];

const timeframeOrder = ["1h", "4h", "1d"];
const defaultRangeByTimeframe: Record<string, string> = {
  "1h": "3M",
  "4h": "1Y",
  "1d": "5Y",
};
const longRangeValues = new Set(["5Y", "MAX"]);
const coverageTolerance = 0.95;

export function availableTimeframes(symbol: SymbolSummary | undefined) {
  if (!symbol) {
    return [];
  }

  const stored = new Set(symbol.timeframes.map((timeframe) => timeframe.timeframe));
  const values = new Set<string>();

  if (stored.has("1h")) {
    values.add("1h");
    values.add("4h");
  }
  if (stored.has("1d")) {
    values.add("1d");
  }

  return Array.from(values).sort(
    (left, right) => timeframeOrder.indexOf(left) - timeframeOrder.indexOf(right),
  );
}

export function coverageForTimeframe(symbol: SymbolSummary | undefined, timeframe: string) {
  const sourceTimeframe = timeframe === "4h" ? "1h" : timeframe;
  return symbol?.timeframes.find((item) => item.timeframe === sourceTimeframe);
}

export function queryWindow(symbol: SymbolSummary | undefined, timeframe: string, range: string) {
  const coverage = coverageForTimeframe(symbol, timeframe);
  if (!coverage) {
    return undefined;
  }

  const rangeOption = rangeOptions.find((option) => option.value === range) ?? rangeOptions[0];
  const endMs = coverage.end_ms;
  const startMs =
    rangeOption.days == null
      ? coverage.start_ms
      : Math.max(coverage.start_ms, endMs - rangeOption.days * 24 * 60 * 60 * 1000);

  return { startMs, endMs };
}

export function coverageWindow(symbol: SymbolSummary | undefined, timeframe: string) {
  const coverage = coverageForTimeframe(symbol, timeframe);
  return coverage ? { startMs: coverage.start_ms, endMs: coverage.end_ms } : undefined;
}

export function defaultRangeForTimeframe(timeframe: string) {
  return defaultRangeByTimeframe[timeframe] ?? rangeOptions[0].value;
}

function timeframeCoversRange(symbol: SymbolSummary | undefined, timeframe: string, range: string) {
  const rangeOption = rangeOptions.find((option) => option.value === range);
  const coverage = coverageForTimeframe(symbol, timeframe);

  if (!rangeOption || !coverage) {
    return false;
  }

  if (rangeOption.days == null) {
    return timeframe === "1d";
  }

  return (
    coverage.end_ms - coverage.start_ms >=
    rangeOption.days * 24 * 60 * 60 * 1000 * coverageTolerance
  );
}

export function timeframeForRange(
  symbol: SymbolSummary | undefined,
  range: string,
  currentTimeframe: string,
  nextTimeframes: string[],
) {
  if (nextTimeframes.length === 0) {
    return currentTimeframe;
  }

  if (
    !longRangeValues.has(range) &&
    nextTimeframes.includes(currentTimeframe) &&
    timeframeCoversRange(symbol, currentTimeframe, range)
  ) {
    return currentTimeframe;
  }

  const preferences = longRangeValues.has(range)
    ? ["1d", "4h", "1h"]
    : [currentTimeframe, "4h", "1h", "1d"];
  const coveredTimeframe = preferences.find(
    (value) => nextTimeframes.includes(value) && timeframeCoversRange(symbol, value, range),
  );

  return coveredTimeframe ?? (nextTimeframes.includes(currentTimeframe) ? currentTimeframe : nextTimeframes[0]);
}
