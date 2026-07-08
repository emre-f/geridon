import type { ChartMode } from "@/components/stock-chart";
import type { IndicatorKind, IndicatorLineStyle, IndicatorSpec } from "@/lib/api";
import { fetchChartStates, putChartState } from "@/lib/api";
import { isHexColor } from "@/lib/color-palette";
import { defaultLineStyle, sanitizeLineStyle } from "@/lib/indicator-style";

const chartStateStorageKey = "geridon-chart-state:v1";
const lastTickerStorageKey = "geridon-last-ticker";
const lastStrategyStorageKey = "geridon-last-strategy";
const serverSaveDelayMs = 600;

const chartModes: ChartMode[] = ["line", "candle"];
const timeframeValues = ["1h", "4h", "1d"];
const rangeValues = ["1M", "3M", "1Y", "5Y", "MAX"];

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
    // Kinds are validated against the backend catalog when indicators are
    // requested, so any non-empty string is accepted here.
    if (
      typeof id !== "string" ||
      typeof kind !== "string" ||
      kind.length === 0 ||
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
    // One pass; the palette index counts only the colors that were kept.
    const legacyStyles: IndicatorLineStyle[] = [];
    if (Array.isArray(colors)) {
      for (const color of colors) {
        if (isHexColor(color)) {
          legacyStyles.push({
            ...defaultLineStyle(specs.length + legacyStyles.length),
            color: color.toLowerCase(),
          });
        }
      }
    }
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

const pendingServerSaves = new Map<string, ReturnType<typeof setTimeout>>();

export function saveChartState(ticker: string, state: ChartState) {
  writeStates({ ...loadStates(), [ticker]: state });

  // Write-through to SQLite, debounced per ticker so rapid edits (parameter
  // nudges, range clicks) collapse into one request. Server failures are
  // ignored: localStorage keeps working and the next edit retries.
  const pending = pendingServerSaves.get(ticker);
  if (pending != null) {
    clearTimeout(pending);
  }
  pendingServerSaves.set(
    ticker,
    setTimeout(() => {
      pendingServerSaves.delete(ticker);
      putChartState(ticker, state).catch(() => {});
    }, serverSaveDelayMs),
  );
}

/**
 * Pulls chart states stored in the backend SQLite database and merges them
 * into localStorage (server wins per ticker). Local-only states survive and
 * upload on their next edit; a missing backend leaves localStorage untouched.
 */
export async function pullChartStates() {
  let serverStates: Record<string, unknown>;
  try {
    serverStates = await fetchChartStates();
  } catch {
    return;
  }

  const merged = { ...loadStates() };
  for (const [ticker, state] of Object.entries(serverStates)) {
    if (sanitizeChartState(state)) {
      merged[ticker] = state;
    }
  }
  writeStates(merged);
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

export function loadLastStrategySelection(): string {
  try {
    return localStorage.getItem(lastStrategyStorageKey) ?? "new";
  } catch {
    return "new";
  }
}

export function saveLastStrategySelection(value: string) {
  try {
    localStorage.setItem(lastStrategyStorageKey, value);
  } catch {
    // Ignore storage failures so strategy selection still works for this session.
  }
}
