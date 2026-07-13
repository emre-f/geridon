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
import { experimentsReducer, initialExperimentsState } from "@/lib/optimize-experiments-state";

const pollIntervalMs = 3000;
const pageSize = 20;
const activeStatuses = new Set(["queued", "running"]);

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
    max_runtime_ms: record.config.max_runtime_ms,
    progress: record.progress,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Experiment history: list with progress polling, plus create/cancel/resume/delete. */
export function useOptimizeExperiments() {
  const [state, dispatch] = useReducer(experimentsReducer, initialExperimentsState);

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

  function handleSelect(experiment: OptimizationExperimentListItem) {
    dispatch({ type: "selected", id: experiment.id });
  }

  return {
    ...state,
    selectedExperiment:
      state.experiments.find((experiment) => experiment.id === state.selectedId) ?? null,
    refresh,
    handleCreate,
    handleCancel,
    handleResume,
    handleDelete,
    handleSelect,
    closeSelected: () => dispatch({ type: "selected", id: null }),
  };
}
