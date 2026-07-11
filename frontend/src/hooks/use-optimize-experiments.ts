import { useCallback, useEffect, useReducer } from "react";

import {
  cancelOptimizationExperiment,
  createOptimizationExperiment,
  deleteOptimizationExperiment,
  listOptimizationExperiments,
  resumeOptimizationExperiment,
  type CreateOptimizationExperimentInput,
  type OptimizationExperimentListItem,
  type OptimizationExperimentRecord,
} from "@/lib/api";

const pollIntervalMs = 3000;
const pageSize = 20;
const activeStatuses = new Set(["queued", "running"]);

interface OptimizeExperimentsState {
  experiments: OptimizationExperimentListItem[];
  total: number;
  loading: boolean;
  creating: boolean;
  actioningId: number | null;
  error: string | null;
}

type OptimizeExperimentsAction =
  | { type: "listRequested" }
  | { type: "listLoaded"; experiments: OptimizationExperimentListItem[]; total: number }
  | { type: "listFailed"; message: string }
  | { type: "creating"; creating: boolean }
  | { type: "created"; experiment: OptimizationExperimentListItem }
  | { type: "actioning"; id: number | null }
  | { type: "updated"; experiment: OptimizationExperimentListItem }
  | { type: "deleted"; id: number }
  | { type: "errorSet"; message: string | null };

function toListItem(record: OptimizationExperimentRecord): OptimizationExperimentListItem {
  return {
    id: record.id,
    status: record.status,
    strategy_id: record.config.strategy_id,
    strategy_name: record.snapshot.strategy_name,
    tickers: record.config.tickers,
    timeframe: record.config.timeframe,
    method: record.config.method,
    max_trials: record.config.max_trials,
    progress: record.progress,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function reducer(
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
      };
    case "deleted":
      return {
        ...state,
        experiments: state.experiments.filter((experiment) => experiment.id !== action.id),
        total: Math.max(0, state.total - 1),
      };
    case "errorSet":
      return { ...state, error: action.message };
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Experiment history: list with progress polling, plus create/cancel/resume/delete. */
export function useOptimizeExperiments() {
  const [state, dispatch] = useReducer(reducer, {
    experiments: [],
    total: 0,
    loading: false,
    creating: false,
    actioningId: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await listOptimizationExperiments({ limit: pageSize, offset: 0 });
      dispatch({ type: "listLoaded", experiments: result.experiments, total: result.total });
    } catch (error) {
      dispatch({ type: "listFailed", message: errorMessage(error, "Could not load experiments.") });
    }
  }, []);

  useEffect(() => {
    dispatch({ type: "listRequested" });
    refresh();
  }, [refresh]);

  const hasActiveExperiment = state.experiments.some((experiment) =>
    activeStatuses.has(experiment.status),
  );
  useEffect(() => {
    if (!hasActiveExperiment) {
      return;
    }
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [hasActiveExperiment, refresh]);

  async function handleCreate(config: CreateOptimizationExperimentInput) {
    dispatch({ type: "creating", creating: true });
    dispatch({ type: "errorSet", message: null });
    try {
      const record = await createOptimizationExperiment(config);
      dispatch({ type: "created", experiment: toListItem(record) });
      return record;
    } catch (error) {
      dispatch({ type: "errorSet", message: errorMessage(error, "Could not start the experiment.") });
      return null;
    } finally {
      dispatch({ type: "creating", creating: false });
    }
  }

  async function handleCancel(experiment: OptimizationExperimentListItem) {
    dispatch({ type: "actioning", id: experiment.id });
    try {
      const record = await cancelOptimizationExperiment(experiment.id);
      dispatch({ type: "updated", experiment: toListItem(record) });
    } catch (error) {
      dispatch({ type: "errorSet", message: errorMessage(error, "Could not cancel the experiment.") });
    } finally {
      dispatch({ type: "actioning", id: null });
    }
  }

  async function handleResume(experiment: OptimizationExperimentListItem) {
    dispatch({ type: "actioning", id: experiment.id });
    try {
      const record = await resumeOptimizationExperiment(experiment.id);
      dispatch({ type: "updated", experiment: toListItem(record) });
    } catch (error) {
      dispatch({ type: "errorSet", message: errorMessage(error, "Could not resume the experiment.") });
    } finally {
      dispatch({ type: "actioning", id: null });
    }
  }

  async function handleDelete(experiment: OptimizationExperimentListItem) {
    if (!window.confirm(`Delete experiment #${experiment.id}? This does not delete saved candidates.`)) {
      return;
    }
    dispatch({ type: "actioning", id: experiment.id });
    try {
      await deleteOptimizationExperiment(experiment.id);
      dispatch({ type: "deleted", id: experiment.id });
    } catch (error) {
      dispatch({ type: "errorSet", message: errorMessage(error, "Could not delete the experiment.") });
    } finally {
      dispatch({ type: "actioning", id: null });
    }
  }

  return {
    ...state,
    refresh,
    handleCreate,
    handleCancel,
    handleResume,
    handleDelete,
  };
}
