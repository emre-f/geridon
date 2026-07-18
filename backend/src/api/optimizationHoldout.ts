import type { Database } from "../db.ts";
import { evaluateBuyHold, evaluateOnFolds, withSizing } from "../services/optimization/evaluate.ts";
import { sizingFromValues } from "../services/optimization/searchSpace.ts";
import { setExperimentHoldout } from "../services/optimization/experimentStore.ts";
import { getTrialDetail } from "../services/optimization/trialStore.ts";
import { holdoutCandleCount, holdoutFoldSpec } from "../services/optimization/holdout.ts";
import type {
  FoldSpec,
  HoldoutEvaluation,
  OptimizationDataset,
  OptimizationExperimentRecord,
} from "../types.ts";
import { loadExperimentDatasets } from "./optimizationRequests.ts";
import { evaluationSettings, snapshotMismatch } from "./optimizationTrials.ts";
import { badRequest, type ApiResult } from "./shared.ts";

/**
 * The one-time sealed-holdout evaluation: the candidate, the untouched
 * baseline, and buy & hold are compared once on the trailing window the
 * optimizer never saw. The result is persisted with an audit timestamp and the
 * holdout can never be opened for a second trial in the same experiment.
 */
export function handleOpenTrialHoldout(
  db: Database,
  experiment: OptimizationExperimentRecord,
  trialPath: string,
): ApiResult {
  const trialIndex = Number(trialPath);
  if (!Number.isInteger(trialIndex) || trialIndex < 0) {
    return badRequest("Trial index must be a non-negative integer.");
  }
  if (!experiment.config.holdout) {
    return badRequest(
      "This experiment was created without a sealed holdout; rerun it with holdout.fraction set.",
    );
  }
  const trial = getTrialDetail(db, experiment.id, trialIndex);
  if (!trial) {
    return {
      statusCode: 404,
      body: { detail: `Trial ${trialIndex} was not found in experiment ${experiment.id}.` },
    };
  }
  if (!trial.strategy) {
    return badRequest("Rejected trials have no candidate strategy to evaluate.");
  }

  if (experiment.holdout) {
    if (experiment.holdout.trial_index === trialIndex) {
      return { statusCode: 200, body: experiment.holdout };
    }
    return {
      statusCode: 409,
      body: {
        detail:
          `The sealed holdout was already opened for trial ${experiment.holdout.trial_index} ` +
          `at ${experiment.holdout.opened_at}; it cannot be reused for another candidate.`,
      },
    };
  }

  let datasets: OptimizationDataset[];
  try {
    datasets = loadExperimentDatasets(db, experiment.config, experiment.snapshot.strategy);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to load experiment data.";
    return { statusCode: 409, body: { detail } };
  }
  const mismatch = snapshotMismatch(experiment.snapshot.datasets, datasets);
  if (mismatch) {
    return { statusCode: 409, body: { detail: mismatch } };
  }

  const settings = evaluationSettings(experiment.config);
  const foldsBySymbol = new Map<string, FoldSpec[]>();
  for (const dataset of datasets) {
    const count = holdoutCandleCount(dataset.candles.length, experiment.config.holdout);
    foldsBySymbol.set(dataset.symbol, [holdoutFoldSpec(dataset.candles.length, count)]);
  }

  const evaluation: HoldoutEvaluation = {
    trial_index: trialIndex,
    opened_at: new Date().toISOString(),
    candidate: evaluateOnFolds(
      trial.strategy,
      datasets,
      foldsBySymbol,
      withSizing(settings, sizingFromValues(trial.values)),
    ),
    baseline: evaluateOnFolds(experiment.snapshot.strategy, datasets, foldsBySymbol, settings),
    buy_hold: evaluateBuyHold(datasets, foldsBySymbol, settings),
  };
  setExperimentHoldout(db, experiment.id, evaluation);
  return { statusCode: 200, body: evaluation };
}
