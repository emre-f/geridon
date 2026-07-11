import type { Database } from "../db.ts";
import { getTrialDetail, listTrials } from "../services/optimization/experimentStore.ts";
import type { OptimizationExperimentRecord, Strategy, TrialStatus } from "../types.ts";
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
