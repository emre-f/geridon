import { useEffect, useMemo, useReducer } from "react";

import {
  getOptimizationExperiment,
  getOptimizationTrial,
  listOptimizationTrials,
  saveOptimizationTrialStrategy,
  type OptimizationTrialRecord,
  type StrategyRecord,
} from "@/lib/api";
import { detailReducer, initialDetailState } from "@/lib/optimize-detail-state";
import {
  inLeaderboardOrder,
  matchesTrialFilter,
  traceSeries,
  type TrialFilter,
} from "@/lib/optimize-detail-utils";

// The API caps both max_trials and the trials page size at 500, so a single
// request always returns every trial of an experiment.
const allTrialsLimit = 500;

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
 * the selected trial's fold details, and candidate save/backtest actions.
 */
export function useOptimizeExperimentDetail({
  experimentId,
  onStrategySaved,
  onOpenInBacktest,
}: DetailOptions) {
  const [state, dispatch] = useReducer(detailReducer, initialDetailState);

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

  const selectedTrialIndex = state.selectedTrialIndex;
  const hasSelectedDetail = selectedTrialIndex != null && selectedTrialIndex in state.trialDetails;

  useEffect(() => {
    if (selectedTrialIndex == null || hasSelectedDetail) {
      return;
    }
    let cancelled = false;

    async function loadDetail() {
      dispatch({ type: "trialDetailRequested" });
      try {
        const detail = await getOptimizationTrial(experimentId, selectedTrialIndex!);
        if (!cancelled) {
          dispatch({ type: "trialDetailLoaded", detail });
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "trialDetailFailed",
            message: errorMessage(error, "Could not load the trial's fold results."),
          });
        }
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [experimentId, selectedTrialIndex, hasSelectedDetail]);

  const trace = useMemo(() => traceSeries(state.trials), [state.trials]);
  const leaderboardTrials = useMemo(
    () =>
      inLeaderboardOrder(state.trials.filter((trial) => matchesTrialFilter(trial, state.filter))),
    [state.trials, state.filter],
  );
  const selectedTrial = useMemo(
    () => state.trials.find((trial) => trial.trial_index === selectedTrialIndex) ?? null,
    [state.trials, selectedTrialIndex],
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
    selectedTrialDetail:
      selectedTrialIndex != null ? (state.trialDetails[selectedTrialIndex] ?? null) : null,
    baselineScore: state.experiment?.summary?.baseline.score.score ?? null,
    setFilter: (filter: TrialFilter) => dispatch({ type: "filterChanged", filter }),
    selectTrial: (trialIndex: number) => dispatch({ type: "trialSelected", trialIndex }),
    handleSave,
    handleOpenInBacktest,
  };
}

export type OptimizeExperimentDetail = ReturnType<typeof useOptimizeExperimentDetail>;
