import type {
  OptimizationExperimentRecord,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";
import type { StrategyRecord } from "@/lib/api-strategy-types";
import type { TrialFilter } from "./optimize-detail-utils.ts";

export interface DetailState {
  experiment: OptimizationExperimentRecord | null;
  trials: OptimizationTrialRecord[];
  loading: boolean;
  filter: TrialFilter;
  selectedTrialIndex: number | null;
  trialDetails: Record<number, OptimizationTrialDetail>;
  trialDetailLoading: boolean;
  savingIndex: number | null;
  savedStrategies: Record<number, StrategyRecord>;
  error: string | null;
}

export type DetailAction =
  | { type: "loadRequested" }
  | { type: "loaded"; experiment: OptimizationExperimentRecord; trials: OptimizationTrialRecord[] }
  | { type: "loadFailed"; message: string }
  | { type: "filterChanged"; filter: TrialFilter }
  | { type: "trialSelected"; trialIndex: number }
  | { type: "trialDetailRequested" }
  | { type: "trialDetailLoaded"; detail: OptimizationTrialDetail }
  | { type: "trialDetailFailed"; message: string }
  | { type: "saveStarted"; trialIndex: number }
  | { type: "saveSucceeded"; trialIndex: number; record: StrategyRecord }
  | { type: "saveFailed"; message: string };

export const initialDetailState: DetailState = {
  experiment: null,
  trials: [],
  loading: true,
  filter: "all",
  selectedTrialIndex: null,
  trialDetails: {},
  trialDetailLoading: false,
  savingIndex: null,
  savedStrategies: {},
  error: null,
};

export function detailReducer(state: DetailState, action: DetailAction): DetailState {
  switch (action.type) {
    case "loadRequested":
      return { ...state, loading: true, error: null };
    case "loaded":
      return { ...state, experiment: action.experiment, trials: action.trials, loading: false };
    case "loadFailed":
      return { ...state, loading: false, error: action.message };
    case "filterChanged":
      return { ...state, filter: action.filter };
    case "trialSelected":
      // Re-selecting the open trial closes its detail section.
      return {
        ...state,
        selectedTrialIndex:
          state.selectedTrialIndex === action.trialIndex ? null : action.trialIndex,
      };
    case "trialDetailRequested":
      return { ...state, trialDetailLoading: true };
    case "trialDetailLoaded":
      return {
        ...state,
        trialDetailLoading: false,
        trialDetails: { ...state.trialDetails, [action.detail.trial_index]: action.detail },
      };
    case "trialDetailFailed":
      return { ...state, trialDetailLoading: false, error: action.message };
    case "saveStarted":
      return { ...state, savingIndex: action.trialIndex, error: null };
    case "saveSucceeded":
      return {
        ...state,
        savingIndex: null,
        savedStrategies: { ...state.savedStrategies, [action.trialIndex]: action.record },
      };
    case "saveFailed":
      return { ...state, savingIndex: null, error: action.message };
  }
}
