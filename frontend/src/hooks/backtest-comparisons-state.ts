import type { BacktestRunRecord, IndicatorLineStyle } from "@/lib/api";
import { holdCurve, optimalCurve, type ComparisonPoint } from "@/lib/backtest-utils";
import { defaultLineStyle } from "@/lib/indicator-style";
import type { BenchmarkId, ComparisonSlot } from "@/components/backtest-types";

export const maxComparisons = 3;
const preferredComparisonTickers = ["SPY", "QQQ"];

interface BenchmarkDefinition {
  id: BenchmarkId;
  label: (run: BacktestRunRecord) => string;
  title?: string;
  curve: typeof holdCurve;
  defaultVisible: boolean;
  defaultStyle: () => IndicatorLineStyle;
}

/** Built-in benchmarks derived from the backtested ticker's own candles. */
export const benchmarkDefinitions: BenchmarkDefinition[] = [
  {
    id: "hold-self",
    label: (run) => `Hold ${run.ticker}`,
    curve: holdCurve,
    defaultVisible: true,
    defaultStyle: () => ({ ...defaultLineStyle(0), stroke: "dashed" as const }),
  },
  {
    id: "optimal",
    label: () => "Optimal",
    title: "Perfect foresight: fixed-size long/short capturing every bar's move",
    curve: optimalCurve,
    defaultVisible: false,
    defaultStyle: () => ({ ...defaultLineStyle(4), stroke: "dotted" as const }),
  },
];

export type BenchmarkSlots = Record<BenchmarkId, { visible: boolean; style: IndicatorLineStyle }>;

export interface ComparisonsState {
  benchmarks: BenchmarkSlots;
  comparisons: ComparisonSlot[];
  /** Buy-and-hold close series per comparison cache key; [] caches a coverage miss. */
  comparisonData: Record<string, ComparisonPoint[]>;
}

export type ComparisonsAction =
  | { type: "benchmarkVisibleChanged"; id: BenchmarkId; visible: boolean }
  | { type: "benchmarkStylePatched"; id: BenchmarkId; patch: Partial<IndicatorLineStyle> }
  | { type: "comparisonAdded"; id: string; tickers: string[]; activeTicker: string | undefined }
  | { type: "comparisonChanged"; id: string; patch: Partial<ComparisonSlot> }
  | { type: "comparisonRemoved"; id: string }
  | { type: "comparisonDataLoaded"; key: string; points: ComparisonPoint[] };

export function initialComparisonsState(): ComparisonsState {
  return {
    benchmarks: Object.fromEntries(
      benchmarkDefinitions.map((definition) => [
        definition.id,
        { visible: definition.defaultVisible, style: definition.defaultStyle() },
      ]),
    ) as BenchmarkSlots,
    comparisons: [],
    comparisonData: {},
  };
}

export function comparisonsReducer(
  state: ComparisonsState,
  action: ComparisonsAction,
): ComparisonsState {
  switch (action.type) {
    case "benchmarkVisibleChanged":
      return {
        ...state,
        benchmarks: {
          ...state.benchmarks,
          [action.id]: { ...state.benchmarks[action.id], visible: action.visible },
        },
      };
    case "benchmarkStylePatched": {
      const slot = state.benchmarks[action.id];
      return {
        ...state,
        benchmarks: {
          ...state.benchmarks,
          [action.id]: { ...slot, style: { ...slot.style, ...action.patch } },
        },
      };
    }
    case "comparisonAdded": {
      if (state.comparisons.length >= maxComparisons) {
        return state;
      }

      const used = new Set([action.activeTicker, ...state.comparisons.map((slot) => slot.ticker)]);
      const nextTicker =
        preferredComparisonTickers.find(
          (candidate) => !used.has(candidate) && action.tickers.includes(candidate),
        ) ??
        action.tickers.find((ticker) => !used.has(ticker)) ??
        action.tickers[0];
      if (!nextTicker) {
        return state;
      }

      return {
        ...state,
        comparisons: [
          ...state.comparisons,
          {
            id: action.id,
            ticker: nextTicker,
            visible: true,
            style: defaultLineStyle(state.comparisons.length + 1),
          },
        ],
      };
    }
    case "comparisonChanged":
      return {
        ...state,
        comparisons: state.comparisons.map((slot) =>
          slot.id === action.id ? { ...slot, ...action.patch } : slot,
        ),
      };
    case "comparisonRemoved":
      return {
        ...state,
        comparisons: state.comparisons.filter((slot) => slot.id !== action.id),
      };
    case "comparisonDataLoaded":
      return { ...state, comparisonData: { ...state.comparisonData, [action.key]: action.points } };
  }
}
