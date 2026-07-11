import type { Database } from "../db.ts";
import type { ExperimentRunner } from "../services/optimization/experimentRunner.ts";
import {
  deleteExperiment,
  getExperiment,
  insertExperiment,
  listExperiments,
  resetExperimentForResume,
} from "../services/optimization/experimentStore.ts";
import { compileSearchSpace } from "../services/optimization/searchSpace.ts";
import { buildFolds } from "../services/optimization/folds.ts";
import type {
  OptimizationExperimentRecord,
  OptimizationExperimentStatus,
  Strategy,
} from "../types.ts";
import {
  datasetSpecs,
  loadExperimentDatasets,
  parseExperimentRequest,
} from "./optimizationRequests.ts";
import { badRequest, parsePositiveId, type ApiResult } from "./shared.ts";

const experimentStatuses: OptimizationExperimentStatus[] = [
  "queued",
  "running",
  "completed",
  "cancelled",
  "interrupted",
  "failed",
];

function notFound(id: number): ApiResult {
  return { statusCode: 404, body: { detail: `Experiment ${id} was not found.` } };
}

export function experimentForPath(
  db: Database,
  idPath: string,
): { experiment: OptimizationExperimentRecord } | { failure: ApiResult } {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return { failure: badRequest("Experiment id must be a positive integer.") };
  }
  const experiment = getExperiment(db, id);
  return experiment ? { experiment } : { failure: notFound(id) };
}

export function handleCreateExperiment(db: Database, runner: ExperimentRunner, body: unknown) {
  const parsed = parseExperimentRequest(body);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }
  const { config } = parsed;

  const strategyRow = db
    .prepare("SELECT name, definition FROM strategies WHERE id = ?")
    .get(config.strategy_id);
  if (!strategyRow) {
    return { statusCode: 404, body: { detail: `Strategy ${config.strategy_id} was not found.` } };
  }
  const strategy = JSON.parse(String(strategyRow.definition)) as Strategy;
  if (config.position_mode === "three_state" && strategy.cash == null) {
    return badRequest("three_state needs a strategy that defines a go-to-cash tree.");
  }

  try {
    const datasets = loadExperimentDatasets(db, config);
    for (const dataset of datasets) {
      try {
        buildFolds(dataset.candles.length, config.folds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return badRequest(`${dataset.symbol}: ${message}`);
      }
    }

    const { nodes } = compileSearchSpace({
      strategy,
      ruleRoles: config.rule_roles,
      parameterOverrides: config.parameter_overrides,
    });
    const hasEvolutionLibrary =
      config.method === "evolution" && (config.evolution?.ruleLibrary?.length ?? 0) > 0;
    if (nodes.length === 0 && !hasEvolutionLibrary) {
      return badRequest(
        "The search space is empty: every parameter is locked and no rule is optional.",
      );
    }

    const record = insertExperiment(db, config, {
      strategy,
      strategy_name: String(strategyRow.name),
      datasets: datasetSpecs(datasets),
    });
    runner.enqueue(record.id);
    return { statusCode: 201, body: record };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid experiment configuration.";
    return badRequest(message);
  }
}

export function handleListExperiments(db: Database, searchParams: URLSearchParams): ApiResult {
  const statusParam = searchParams.get("status");
  if (statusParam && !experimentStatuses.includes(statusParam as OptimizationExperimentStatus)) {
    return badRequest(`status must be one of ${experimentStatuses.join(", ")}.`);
  }
  const limit = Number(searchParams.get("limit") ?? 20);
  const offset = Number(searchParams.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badRequest("limit must be an integer between 1 and 100.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return badRequest("offset must be a non-negative integer.");
  }
  const { total, experiments } = listExperiments(db, {
    ...(statusParam ? { status: statusParam as OptimizationExperimentStatus } : {}),
    limit,
    offset,
  });
  return { statusCode: 200, body: { total, limit, offset, experiments } };
}

export function handleGetExperiment(db: Database, idPath: string): ApiResult {
  const resolved = experimentForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  return { statusCode: 200, body: resolved.experiment };
}

export function handleCancelExperiment(
  db: Database,
  runner: ExperimentRunner,
  idPath: string,
): ApiResult {
  const resolved = experimentForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  const { experiment } = resolved;
  if (experiment.status !== "queued" && experiment.status !== "running") {
    return {
      statusCode: 409,
      body: { detail: `Experiment ${experiment.id} is already ${experiment.status}.` },
    };
  }
  const outcome = runner.cancel(experiment.id);
  return {
    statusCode: 202,
    body: {
      ...getExperiment(db, experiment.id)!,
      cancel_requested: outcome === "cancelling",
    },
  };
}

export function handleResumeExperiment(
  db: Database,
  runner: ExperimentRunner,
  idPath: string,
): ApiResult {
  const resolved = experimentForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  const { experiment } = resolved;
  if (
    experiment.status !== "interrupted" &&
    experiment.status !== "cancelled" &&
    experiment.status !== "failed"
  ) {
    return {
      statusCode: 409,
      body: { detail: `Only interrupted, cancelled, or failed experiments can be resumed.` },
    };
  }
  resetExperimentForResume(db, experiment.id);
  runner.enqueue(experiment.id);
  return { statusCode: 202, body: getExperiment(db, experiment.id)! };
}

export function handleDeleteExperiment(
  db: Database,
  runner: ExperimentRunner,
  idPath: string,
): ApiResult {
  const resolved = experimentForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  const { experiment } = resolved;
  if (runner.isRunning(experiment.id)) {
    return {
      statusCode: 409,
      body: { detail: "Cancel the experiment before deleting it." },
    };
  }
  deleteExperiment(db, experiment.id);
  return { statusCode: 200, body: { id: experiment.id, deleted: true } };
}
