import type { ChartMode } from "@/components/stock-chart";
import type { IndicatorKind, IndicatorLineStyle, IndicatorSpec } from "@/lib/api";
import { isHexColor } from "@/lib/color-palette";
import { defaultLineStyle, sanitizeLineStyle } from "@/lib/indicator-style";

const chartStateStorageKey = "geridon-chart-state";
const lastTickerStorageKey = "geridon-last-ticker";

const chartModes: ChartMode[] = ["line", "candle"];
const timeframeValues = ["1h", "4h", "1d"];
const rangeValues = ["1M", "3M", "1Y", "5Y", "MAX"];
const indicatorKinds: IndicatorKind[] = ["sma", "ema", "rsi", "macd", "bollinger", "atr"];

export interface ChartState {
  chartMode: ChartMode;
  timeframe: string;
  range: string;
  indicators: IndicatorSpec[];
}

function sanitizeIndicators(value: unknown): IndicatorSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const specs: IndicatorSpec[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry == null) {
      continue;
    }

    const { id, kind, parameters, styles, colors } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !indicatorKinds.includes(kind as IndicatorKind) ||
      typeof parameters !== "object" ||
      parameters == null
    ) {
      continue;
    }

    const sanitizedParameters: Record<string, number> = {};
    for (const [key, parameterValue] of Object.entries(parameters)) {
      if (typeof parameterValue === "number" && Number.isFinite(parameterValue)) {
        sanitizedParameters[key] = parameterValue;
      }
    }

    // Older stored states carried a plain color list; fold it into styles.
    const legacyStyles = Array.isArray(colors)
      ? colors
          .filter(isHexColor)
          .map((color, colorIndex) => ({
            ...defaultLineStyle(specs.length + colorIndex),
            color: color.toLowerCase(),
          }))
      : [];
    const sanitizedStyles: IndicatorLineStyle[] = Array.isArray(styles)
      ? styles.map((style, styleIndex) =>
          sanitizeLineStyle(style, defaultLineStyle(specs.length + styleIndex)),
        )
      : legacyStyles;

    specs.push({
      id,
      kind: kind as IndicatorKind,
      parameters: sanitizedParameters,
      ...(sanitizedStyles.length > 0 ? { styles: sanitizedStyles } : {}),
    });
  }

  return specs;
}

function sanitizeChartState(value: unknown): ChartState | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    !chartModes.includes(record.chartMode as ChartMode) ||
    !timeframeValues.includes(record.timeframe as string) ||
    !rangeValues.includes(record.range as string)
  ) {
    return null;
  }

  return {
    chartMode: record.chartMode as ChartMode,
    timeframe: record.timeframe as string,
    range: record.range as string,
    indicators: sanitizeIndicators(record.indicators),
  };
}

function loadStates(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(chartStateStorageKey) ?? "{}");
    if (typeof parsed === "object" && parsed != null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to an empty map when storage is unavailable or malformed.
  }

  return {};
}

function writeStates(states: Record<string, unknown>) {
  try {
    localStorage.setItem(chartStateStorageKey, JSON.stringify(states));
  } catch {
    // Ignore storage failures so chart edits still work for this session.
  }
}

export function loadChartState(ticker: string): ChartState | null {
  return sanitizeChartState(loadStates()[ticker]);
}

export function saveChartState(ticker: string, state: ChartState) {
  writeStates({ ...loadStates(), [ticker]: state });
}

export function removeChartState(ticker: string) {
  const states = loadStates();
  if (!(ticker in states)) {
    return;
  }

  delete states[ticker];
  writeStates(states);
}

export function loadLastTicker(): string | null {
  try {
    return localStorage.getItem(lastTickerStorageKey);
  } catch {
    return null;
  }
}

export function saveLastTicker(ticker: string) {
  try {
    localStorage.setItem(lastTickerStorageKey, ticker);
  } catch {
    // Ignore storage failures so symbol selection still works for this session.
  }
}
