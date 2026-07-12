import type { OptimizationExperimentListItem } from "@/lib/api-optimization-experiment-types";
import { canCancel } from "./optimize-utils.ts";

export interface OptimizeExperimentsState {
  experiments: OptimizationExperimentListItem[];
  total: number;
  loading: boolean;
  creating: boolean;
  actioningId: number | null;
  /** Experiment whose result card is open below the list. */
  selectedId: number | null;
  error: string | null;
}

export type OptimizeExperimentsAction =
  | { type: "listRequested" }
  | { type: "listLoaded"; experiments: OptimizationExperimentListItem[]; total: number }
  | { type: "listFailed"; message: string }
  | { type: "creating"; creating: boolean }
  | { type: "created"; experiment: OptimizationExperimentListItem }
  | { type: "actioning"; id: number | null }
  | { type: "updated"; experiment: OptimizationExperimentListItem }
  | { type: "deleted"; id: number }
  | { type: "selected"; id: number | null }
  | { type: "errorSet"; message: string | null };

export const initialExperimentsState: OptimizeExperimentsState = {
  experiments: [],
  total: 0,
  loading: false,
  creating: false,
  actioningId: null,
  selectedId: null,
  error: null,
};

export function experimentsReducer(
  state: OptimizeExperimentsState,
  action: OptimizeExperimentsAction,
): OptimizeExperimentsState {
  switch (action.type) {
    case "listRequested":
      return { ...state, loading: true };
    case "listLoaded":
      return { ...state, experiments: action.experiments, total: action.total, loading: false };
    case "listFailed":
      return { ...state, loading: false, error: action.message };
    case "creating":
      return { ...state, creating: action.creating };
    case "created":
      return {
        ...state,
        experiments: [action.experiment, ...state.experiments],
        total: state.total + 1,
      };
    case "actioning":
      return { ...state, actioningId: action.id };
    case "updated":
      return {
        ...state,
        experiments: state.experiments.map((experiment) =>
          experiment.id === action.experiment.id ? action.experiment : experiment,
        ),
        // A resumed experiment is active again and has no results to show.
        selectedId:
          action.experiment.id === state.selectedId && canCancel(action.experiment.status)
            ? null
            : state.selectedId,
      };
    case "deleted":
      return {
        ...state,
        experiments: state.experiments.filter((experiment) => experiment.id !== action.id),
        total: Math.max(0, state.total - 1),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    case "selected":
      // Re-selecting the open experiment closes its result card.
      return {
        ...state,
        selectedId: action.id != null && state.selectedId === action.id ? null : action.id,
      };
    case "errorSet":
      return { ...state, error: action.message };
  }
}
