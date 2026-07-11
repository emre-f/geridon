import { useEffect, useMemo, useReducer } from "react";

import {
  getOptimizationExperiment,
  listOptimizationTrials,
  saveOptimizationTrialStrategy,
  type OptimizationExperimentRecord,
  type OptimizationTrialRecord,
  type StrategyRecord,
} from "@/lib/api";
import {
  inLeaderboardOrder,
  matchesTrialFilter,
  traceSeries,
  type TrialFilter,
} from "@/lib/optimize-detail-utils";

// The API caps both max_trials and the trials page size at 500, so a single
// request always returns every trial of an experiment.
const allTrialsLimit = 500;

interface DetailState {
  experiment: OptimizationExperimentRecord | null;
  trials: OptimizationTrialRecord[];
  loading: boolean;
  filter: TrialFilter;
  selectedTrialIndex: number | null;
  savingIndex: number | null;
  savedStrategies: Record<number, StrategyRecord>;
  error: string | null;
}

type DetailAction =
  | { type: "loadRequested" }
  | { type: "loaded"; experiment: OptimizationExperimentRecord; trials: OptimizationTrialRecord[] }
  | { type: "loadFailed"; message: string }
  | { type: "filterChanged"; filter: TrialFilter }
  | { type: "trialSelected"; trialIndex: number | null }
  | { type: "saveStarted"; trialIndex: number }
  | { type: "saveSucceeded"; trialIndex: number; record: StrategyRecord }
  | { type: "saveFailed"; message: string };

function reducer(state: DetailState, action: DetailAction): DetailState {
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
      return { ...state, selectedTrialIndex: action.trialIndex };
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

interface DetailOptions {
  experimentId: number;
  onStrategySaved: (record: StrategyRecord) => void;
  onOpenInBacktest: (strategyId: number) => void;
}

/**
 * Everything the experiment result card shows: the experiment record with its
 * summary, every trial (fetched once), chart series, the filtered leaderboard,
 * and candidate save/backtest actions.
 */
export function useOptimizeExperimentDetail({
  experimentId,
  onStrategySaved,
  onOpenInBacktest,
}: DetailOptions) {
  const [state, dispatch] = useReducer(reducer, {
    experiment: null,
    trials: [],
    loading: true,
    filter: "all",
    selectedTrialIndex: null,
    savingIndex: null,
    savedStrategies: {},
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatch({ type: "loadRequested" });
      try {
        const [experiment, page] = await Promise.all([
          getOptimizationExperiment(experimentId),
          listOptimizationTrials(experimentId, { limit: allTrialsLimit }),
        ]);
        if (!cancelled) {
          dispatch({ type: "loaded", experiment, trials: page.trials });
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "loadFailed",
            message: errorMessage(error, "Could not load the experiment results."),
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  const trace = useMemo(() => traceSeries(state.trials), [state.trials]);
  const leaderboardTrials = useMemo(
    () =>
      inLeaderboardOrder(state.trials.filter((trial) => matchesTrialFilter(trial, state.filter))),
    [state.trials, state.filter],
  );
  const selectedTrial = useMemo(
    () =>
      state.trials.find((trial) => trial.trial_index === state.selectedTrialIndex) ?? null,
    [state.trials, state.selectedTrialIndex],
  );

  async function handleSave(trial: OptimizationTrialRecord): Promise<StrategyRecord | null> {
    const existing = state.savedStrategies[trial.trial_index];
    if (existing) {
      return existing;
    }

    dispatch({ type: "saveStarted", trialIndex: trial.trial_index });
    try {
      const record = await saveOptimizationTrialStrategy(experimentId, trial.trial_index);
      dispatch({ type: "saveSucceeded", trialIndex: trial.trial_index, record });
      onStrategySaved(record);
      return record;
    } catch (error) {
      dispatch({ type: "saveFailed", message: errorMessage(error, "Could not save the candidate.") });
      return null;
    }
  }

  async function handleOpenInBacktest(trial: OptimizationTrialRecord) {
    const record = await handleSave(trial);
    if (record) {
      onOpenInBacktest(record.id);
    }
  }

  return {
    ...state,
    trace,
    leaderboardTrials,
    selectedTrial,
    baselineScore: state.experiment?.summary?.baseline.score.score ?? null,
    setFilter: (filter: TrialFilter) => dispatch({ type: "filterChanged", filter }),
    selectTrial: (trialIndex: number) =>
      dispatch({
        type: "trialSelected",
        trialIndex: state.selectedTrialIndex === trialIndex ? null : trialIndex,
      }),
    handleSave,
    handleOpenInBacktest,
  };
}

export type OptimizeExperimentDetail = ReturnType<typeof useOptimizeExperimentDetail>;
