import type { Database } from "../db.ts";
import { equityOnFolds, type EvaluationSettings } from "../services/optimization/evaluate.ts";
import { getTrialDetail, listTrials } from "../services/optimization/experimentStore.ts";
import { buildFolds } from "../services/optimization/folds.ts";
import { searchDatasets } from "../services/optimization/holdout.ts";
import { resolveScoringConfig } from "../services/optimization/scoring.ts";
import type {
  ExperimentDatasetSpec,
  FoldSpec,
  OptimizationDataset,
  OptimizationExperimentRecord,
  Strategy,
  TrialStatus,
} from "../types.ts";
import { loadExperimentDatasets } from "./optimizationRequests.ts";
import { handleCreateStrategy } from "./strategies.ts";
import { badRequest, type ApiResult } from "./shared.ts";

const trialStatuses: TrialStatus[] = ["pending", "scored", "pruned", "rejected"];

export function handleListExperimentTrials(
  db: Database,
  experiment: OptimizationExperimentRecord,
  searchParams: URLSearchParams,
): ApiResult {
  const statusParam = searchParams.get("status");
  if (statusParam && !trialStatuses.includes(statusParam as TrialStatus)) {
    return badRequest(`status must be one of ${trialStatuses.join(", ")}.`);
  }
  const eligibleParam = searchParams.get("eligible");
  if (eligibleParam && eligibleParam !== "true" && eligibleParam !== "false") {
    return badRequest("eligible must be true or false.");
  }
  const limit = Number(searchParams.get("limit") ?? 50);
  const offset = Number(searchParams.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return badRequest("limit must be an integer between 1 and 500.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return badRequest("offset must be a non-negative integer.");
  }

  const { total, trials } = listTrials(db, experiment.id, {
    ...(statusParam ? { status: statusParam } : {}),
    ...(eligibleParam ? { eligible: eligibleParam === "true" } : {}),
    limit,
    offset,
  });
  return { statusCode: 200, body: { total, limit, offset, trials } };
}

export function handleGetExperimentTrial(
  db: Database,
  experiment: OptimizationExperimentRecord,
  trialPath: string,
): ApiResult {
  const trialIndex = Number(trialPath);
  if (!Number.isInteger(trialIndex) || trialIndex < 0) {
    return badRequest("Trial index must be a non-negative integer.");
  }
  const trial = getTrialDetail(db, experiment.id, trialIndex);
  if (!trial) {
    return {
      statusCode: 404,
      body: { detail: `Trial ${trialIndex} was not found in experiment ${experiment.id}.` },
    };
  }
  return { statusCode: 200, body: trial };
}

export function snapshotMismatch(
  specs: ExperimentDatasetSpec[],
  datasets: OptimizationDataset[],
): string | null {
  for (const spec of specs) {
    const dataset = datasets.find((candidate) => candidate.symbol === spec.ticker);
    const matches =
      dataset &&
      dataset.candles.length === spec.candle_count &&
      dataset.candles[0].timestamp_ms === spec.first_candle_ms &&
      dataset.candles[dataset.candles.length - 1].timestamp_ms === spec.last_candle_ms;
    if (!matches) {
      return `Stored ${spec.ticker} candles no longer match the experiment snapshot, so results cannot be recomputed faithfully.`;
    }
  }
  return null;
}

export function evaluationSettings(
  config: OptimizationExperimentRecord["config"],
): EvaluationSettings {
  return {
    positionMode: config.position_mode,
    buyPercent: config.buy_percent,
    sellPercent: config.sell_percent,
    initialCapital: config.initial_capital,
    costs: config.costs,
    objective: resolveScoringConfig(config.scoring).objective,
  };
}

export function handleGetTrialEquity(
  db: Database,
  experiment: OptimizationExperimentRecord,
  trialPath: string,
): ApiResult {
  const trialIndex = Number(trialPath);
  if (!Number.isInteger(trialIndex) || trialIndex < 0) {
    return badRequest("Trial index must be a non-negative integer.");
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

  let loaded: OptimizationDataset[];
  try {
    loaded = loadExperimentDatasets(db, experiment.config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to load experiment data.";
    return { statusCode: 409, body: { detail } };
  }
  const mismatch = snapshotMismatch(experiment.snapshot.datasets, loaded);
  if (mismatch) {
    return { statusCode: 409, body: { detail: mismatch } };
  }

  const config = experiment.config;
  const settings = evaluationSettings(config);
  const datasets = searchDatasets(loaded, config.holdout);
  const foldsBySymbol = new Map<string, FoldSpec[]>();
  for (const dataset of datasets) {
    foldsBySymbol.set(dataset.symbol, buildFolds(dataset.candles.length, config.folds));
  }
  return {
    statusCode: 200,
    body: {
      trial_index: trialIndex,
      initial_capital: config.initial_capital,
      candidate: equityOnFolds(trial.strategy, datasets, foldsBySymbol, settings),
      baseline: equityOnFolds(experiment.snapshot.strategy, datasets, foldsBySymbol, settings),
    },
  };
}

export function handleSaveTrialStrategy(
  db: Database,
  experiment: OptimizationExperimentRecord,
  trialPath: string,
  body: unknown,
): ApiResult {
  const trialIndex = Number(trialPath);
  if (!Number.isInteger(trialIndex) || trialIndex < 0) {
    return badRequest("Trial index must be a non-negative integer.");
  }
  const trial = getTrialDetail(db, experiment.id, trialIndex);
  if (!trial) {
    return {
      statusCode: 404,
      body: { detail: `Trial ${trialIndex} was not found in experiment ${experiment.id}.` },
    };
  }
  if (!trial.strategy) {
    return badRequest("Rejected trials have no candidate strategy to save.");
  }

  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  let name = `${experiment.snapshot.strategy_name} (exp ${experiment.id} trial ${trialIndex})`;
  if (raw.name != null) {
    if (typeof raw.name !== "string" || !raw.name.trim()) {
      return badRequest("name must be a non-empty string.");
    }
    name = raw.name.trim();
  }
  if (name.length > 80) {
    return badRequest("name must be 80 characters or fewer.");
  }

  const definition: Strategy = { ...trial.strategy, name };
  return handleCreateStrategy(db, definition);
}
