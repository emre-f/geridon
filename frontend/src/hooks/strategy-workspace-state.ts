import type {
  IndicatorLineStyle,
  IndicatorSeries,
  IndicatorSpec,
  StrategyDraft,
  StrategyRecord,
  StrategySignal,
  StrategyValidationResult,
} from "@/lib/api";
import { normalizeLineStyles } from "@/lib/indicator-style";

export interface StrategyWorkspaceState {
  strategies: StrategyRecord[];
  strategiesLoading: boolean;
  /** True once the remembered (or new) strategy has been opened after the initial loads. */
  initialized: boolean;
  selectedId: number | null;
  draft: StrategyDraft | null;
  validation: StrategyValidationResult | null;
  /** Most recent draft that passed validation; signals preview from this one. */
  lastValidDraft: StrategyDraft | null;
  previewSpecs: IndicatorSpec[];
  indicatorSeries: IndicatorSeries[];
  indicatorsLoading: boolean;
  signals: StrategySignal[];
  saving: boolean;
  validating: boolean;
  error: string | null;
}

export const initialStrategyWorkspaceState: StrategyWorkspaceState = {
  strategies: [],
  strategiesLoading: true,
  initialized: false,
  selectedId: null,
  draft: null,
  validation: null,
  lastValidDraft: null,
  previewSpecs: [],
  indicatorSeries: [],
  indicatorsLoading: false,
  signals: [],
  saving: false,
  validating: false,
  error: null,
};

/** Everything that changes when a strategy (saved or new) is opened in the builder. */
interface OpenedStrategy {
  id: number | null;
  draft: StrategyDraft;
  previewSpecs: IndicatorSpec[];
}

export type StrategyWorkspaceAction =
  | { type: "strategiesLoaded"; records: StrategyRecord[] }
  | { type: "strategiesFailed"; message: string }
  | { type: "initialized"; opened: OpenedStrategy }
  | { type: "opened"; opened: OpenedStrategy }
  | { type: "duplicated"; name: string }
  | { type: "draftChanged"; draft: StrategyDraft }
  | { type: "validateStarted" }
  | {
      type: "validated";
      result: StrategyValidationResult;
      draft: StrategyDraft;
      previewSpecs: IndicatorSpec[];
    }
  | { type: "validateFinished" }
  | { type: "saveStarted" }
  | {
      type: "saved";
      record: StrategyRecord;
      opened: OpenedStrategy;
      validation: StrategyValidationResult;
    }
  | { type: "saveFinished" }
  | { type: "deleted"; id: number }
  | { type: "leftStrategiesTab"; draft: StrategyDraft | null }
  | { type: "signalsCleared" }
  | { type: "signalsLoaded"; signals: StrategySignal[] }
  | { type: "indicatorsRequested" }
  | { type: "indicatorSeriesLoaded"; series: IndicatorSeries[] }
  | { type: "indicatorsFailed"; message: string }
  | { type: "indicatorsCleared" }
  | {
      type: "previewStyleChanged";
      id: string;
      slotIndex: number;
      slotCount: number;
      patch: Partial<IndicatorLineStyle>;
    }
  | { type: "errorSet"; message: string | null };

/**
 * Preview specs are rebuilt from the draft on every rule edit; carry over
 * user-chosen line styles. Ids embed the operand index (which shifts as rules
 * change), so match on kind + parameters instead.
 */
function carryOverPreviewStyles(previous: IndicatorSpec[], next: IndicatorSpec[]) {
  return next.map((spec) => {
    const match = previous.find(
      (candidate) =>
        candidate.kind === spec.kind &&
        JSON.stringify(candidate.parameters) === JSON.stringify(spec.parameters),
    );

    return match?.styles ? { ...spec, styles: match.styles } : spec;
  });
}

function withOpenedStrategy(
  state: StrategyWorkspaceState,
  opened: OpenedStrategy,
): StrategyWorkspaceState {
  return {
    ...state,
    selectedId: opened.id,
    draft: opened.draft,
    validation: null,
    error: null,
    lastValidDraft: opened.draft,
    previewSpecs: carryOverPreviewStyles(state.previewSpecs, opened.previewSpecs),
    signals: [],
  };
}

export function strategyWorkspaceReducer(
  state: StrategyWorkspaceState,
  action: StrategyWorkspaceAction,
): StrategyWorkspaceState {
  switch (action.type) {
    case "strategiesLoaded":
      return { ...state, strategies: action.records, strategiesLoading: false };
    case "strategiesFailed":
      return { ...state, error: action.message, strategiesLoading: false };
    case "initialized":
      return {
        ...withOpenedStrategy(state, action.opened),
        validation: state.validation,
        error: state.error,
        initialized: true,
      };
    case "opened":
      return withOpenedStrategy(state, action.opened);
    case "duplicated":
      return state.draft == null
        ? state
        : {
            ...state,
            selectedId: null,
            draft: { ...state.draft, name: action.name },
            validation: null,
            error: null,
          };
    case "draftChanged":
      return { ...state, draft: action.draft, validation: null, error: null };
    case "validateStarted":
      return { ...state, validating: true, error: null };
    case "validated": {
      const next = { ...state, validation: action.result };
      if (!action.result.valid) {
        return next;
      }

      return {
        ...next,
        lastValidDraft: action.draft,
        previewSpecs: carryOverPreviewStyles(state.previewSpecs, action.previewSpecs),
      };
    }
    case "validateFinished":
      return { ...state, validating: false };
    case "saveStarted":
      return { ...state, saving: true, error: null };
    case "saved": {
      const others = state.strategies.filter((strategy) => strategy.id !== action.record.id);
      const strategies = [...others, action.record].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id - right.id,
      );

      return {
        ...withOpenedStrategy({ ...state, strategies }, action.opened),
        validation: action.validation,
      };
    }
    case "saveFinished":
      return { ...state, saving: false };
    case "deleted":
      return {
        ...state,
        strategies: state.strategies.filter((strategy) => strategy.id !== action.id),
      };
    case "leftStrategiesTab":
      return { ...state, draft: action.draft ?? state.draft, validation: null, error: null };
    case "signalsCleared":
      return state.signals.length === 0 ? state : { ...state, signals: [] };
    case "signalsLoaded":
      return { ...state, signals: action.signals };
    case "indicatorsRequested":
      return { ...state, indicatorsLoading: true, error: null };
    case "indicatorSeriesLoaded":
      return { ...state, indicatorSeries: action.series, indicatorsLoading: false };
    case "indicatorsFailed":
      return { ...state, indicatorSeries: [], indicatorsLoading: false, error: action.message };
    case "indicatorsCleared":
      return { ...state, indicatorSeries: [], indicatorsLoading: false };
    case "previewStyleChanged":
      return {
        ...state,
        previewSpecs: state.previewSpecs.map((spec, specIndex) => {
          if (spec.id !== action.id) {
            return spec;
          }

          const styles = normalizeLineStyles(
            spec.styles,
            Math.max(action.slotCount, action.slotIndex + 1),
            specIndex,
          );
          styles[action.slotIndex] = { ...styles[action.slotIndex], ...action.patch };
          return { ...spec, styles };
        }),
      };
    case "errorSet":
      return { ...state, error: action.message };
  }
}
