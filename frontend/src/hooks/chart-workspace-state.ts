import type {
  Candle,
  IndicatorDefinition,
  IndicatorLineStyle,
  IndicatorSeries,
  IndicatorSpec,
} from "@/lib/api";
import type { ChartState } from "@/lib/chart-state";
import { defaultLineStyle, definitionValueSlots, normalizeLineStyles } from "@/lib/indicator-style";
import type { ChartMode } from "@/components/stock-chart";

export const maxActiveIndicators = 6;

export interface CandleData {
  ticker: string;
  timeframe: string;
  startMs: number;
  endMs: number;
  candles: Candle[];
}

export interface ChartWorkspaceState {
  chartMode: ChartMode;
  timeframe: string;
  range: string;
  activeIndicators: IndicatorSpec[];
  indicatorPickerOpen: boolean;
  candleData: CandleData | null;
  visibleCandles: Candle[];
  candlesLoading: boolean;
  indicatorSeries: IndicatorSeries[];
  indicatorsLoading: boolean;
  hoverCandle: Candle | null;
}

export type ChartWorkspaceAction =
  | { type: "modeChanged"; mode: ChartMode }
  | { type: "timeframeChanged"; timeframe: string; range: string }
  | { type: "rangeChanged"; timeframe: string; range: string }
  | { type: "chartStateRestored"; stored: ChartState | null; timeframeAllowed: boolean }
  | { type: "pickerToggled"; open: boolean }
  | { type: "indicatorAdded"; id: string; definition: IndicatorDefinition }
  | { type: "indicatorRemoved"; id: string }
  | { type: "indicatorParameterChanged"; id: string; key: string; value: number }
  | {
      type: "indicatorStyleChanged";
      id: string;
      slotIndex: number;
      slotCount: number;
      patch: Partial<IndicatorLineStyle>;
    }
  | { type: "candlesRequested" }
  | { type: "candlesLoaded"; data: CandleData }
  | { type: "candlesFailed" }
  | { type: "candlesUnavailable" }
  | { type: "candleDataCleared" }
  | { type: "indicatorsRequested" }
  | { type: "indicatorSeriesLoaded"; series: IndicatorSeries[] }
  | { type: "indicatorsFailed" }
  | { type: "indicatorsCleared" }
  | { type: "visibleCandlesChanged"; candles: Candle[] }
  | { type: "visibleCandlesReset" }
  | { type: "hoverChanged"; candle: Candle | null };

export function initialChartWorkspaceState(timeframe: string, range: string): ChartWorkspaceState {
  return {
    chartMode: "line",
    timeframe,
    range,
    activeIndicators: [],
    indicatorPickerOpen: false,
    candleData: null,
    visibleCandles: [],
    candlesLoading: false,
    indicatorSeries: [],
    indicatorsLoading: false,
    hoverCandle: null,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defaultIndicatorParameters(definition: IndicatorDefinition) {
  return Object.fromEntries(
    definition.parameters.map((parameter) => [parameter.key, parameter.default_value]),
  );
}

/** MACD's fast period must stay below its slow period; nudge the other side when they cross. */
function reconcileMacdPeriods(parameters: Record<string, number>, changedKey: string) {
  if (changedKey === "fast" && parameters.fast >= parameters.slow) {
    if (parameters.fast >= 500) {
      parameters.fast = 499;
      parameters.slow = 500;
    } else {
      parameters.slow = clampNumber(parameters.fast + 1, 2, 500);
    }
  }
  if (changedKey === "slow" && parameters.slow <= parameters.fast) {
    parameters.fast = clampNumber(parameters.slow - 1, 1, 499);
  }
}

function withPatchedStyle(
  indicators: IndicatorSpec[],
  action: Extract<ChartWorkspaceAction, { type: "indicatorStyleChanged" }>,
) {
  return indicators.map((indicator, indicatorIndex) => {
    if (indicator.id !== action.id) {
      return indicator;
    }

    const styles = normalizeLineStyles(
      indicator.styles,
      Math.max(action.slotCount, action.slotIndex + 1),
      indicatorIndex,
    );
    styles[action.slotIndex] = { ...styles[action.slotIndex], ...action.patch };
    return { ...indicator, styles };
  });
}

export function chartWorkspaceReducer(
  state: ChartWorkspaceState,
  action: ChartWorkspaceAction,
): ChartWorkspaceState {
  switch (action.type) {
    case "modeChanged":
      return { ...state, chartMode: action.mode };
    case "timeframeChanged":
    case "rangeChanged":
      return { ...state, timeframe: action.timeframe, range: action.range };
    case "chartStateRestored": {
      const next = { ...state, activeIndicators: action.stored?.indicators ?? [] };
      if (!action.stored) {
        return next;
      }

      next.chartMode = action.stored.chartMode;
      if (action.timeframeAllowed) {
        next.timeframe = action.stored.timeframe;
        next.range = action.stored.range;
      }
      return next;
    }
    case "pickerToggled":
      return { ...state, indicatorPickerOpen: action.open };
    case "indicatorAdded": {
      if (state.activeIndicators.length >= maxActiveIndicators) {
        return state;
      }

      return {
        ...state,
        activeIndicators: [
          ...state.activeIndicators,
          {
            id: action.id,
            kind: action.definition.kind,
            parameters: defaultIndicatorParameters(action.definition),
            styles: definitionValueSlots(action.definition).map((_, slotIndex) =>
              defaultLineStyle(state.activeIndicators.length + slotIndex),
            ),
          },
        ],
      };
    }
    case "indicatorRemoved":
      return {
        ...state,
        activeIndicators: state.activeIndicators.filter((indicator) => indicator.id !== action.id),
      };
    case "indicatorParameterChanged":
      return {
        ...state,
        activeIndicators: state.activeIndicators.map((indicator) => {
          if (indicator.id !== action.id) {
            return indicator;
          }

          const nextParameters = { ...indicator.parameters, [action.key]: action.value };
          if (indicator.kind === "macd") {
            reconcileMacdPeriods(nextParameters, action.key);
          }
          return { ...indicator, parameters: nextParameters };
        }),
      };
    case "indicatorStyleChanged":
      return { ...state, activeIndicators: withPatchedStyle(state.activeIndicators, action) };
    case "candlesRequested":
      return { ...state, candlesLoading: true };
    case "candlesLoaded":
      return { ...state, candleData: action.data, visibleCandles: [], candlesLoading: false };
    case "candlesFailed":
      return { ...state, candleData: null, visibleCandles: [], candlesLoading: false };
    case "candlesUnavailable":
      return { ...state, candleData: null, visibleCandles: [], indicatorSeries: [] };
    case "candleDataCleared":
      return { ...state, candleData: null };
    case "indicatorsRequested":
      return { ...state, indicatorsLoading: true };
    case "indicatorSeriesLoaded":
      return { ...state, indicatorSeries: action.series, indicatorsLoading: false };
    case "indicatorsFailed":
      return { ...state, indicatorSeries: [], indicatorsLoading: false };
    case "indicatorsCleared":
      return { ...state, indicatorSeries: [], indicatorsLoading: false };
    case "visibleCandlesChanged":
      // Keep the empty-state identity stable so the chart's notify effect can't
      // ping-pong renders with this component.
      return state.visibleCandles.length === 0 && action.candles.length === 0
        ? state
        : { ...state, visibleCandles: action.candles };
    case "visibleCandlesReset":
      return state.visibleCandles.length === 0 ? state : { ...state, visibleCandles: [] };
    case "hoverChanged":
      return { ...state, hoverCandle: action.candle };
  }
}
