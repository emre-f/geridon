import { fetchJson } from "@/lib/api-client";
import type {
  HoldoutEvaluation,
  OptimizationExperimentConfig,
  OptimizationExperimentListItem,
  OptimizationExperimentRecord,
  OptimizationExperimentStatus,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
  SearchSpacePreview,
  TrialEquityResponse,
} from "@/lib/api-types";
import type { StrategyRecord } from "@/lib/api-strategy-types";

const basePath = "/api/v1/optimization-experiments";

export type CreateOptimizationExperimentInput = Pick<OptimizationExperimentConfig, "strategy_id" | "tickers" | "timeframe" | "start_ms" | "end_ms"> &
  Partial<
    Omit<OptimizationExperimentConfig, "strategy_id" | "tickers" | "timeframe" | "start_ms" | "end_ms">
  >;

export function createOptimizationExperiment(config: CreateOptimizationExperimentInput) {
  return fetchJson<OptimizationExperimentRecord>(basePath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
}

export function listOptimizationExperiments(options?: {
  status?: OptimizationExperimentStatus;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  params.set("limit", String(options?.limit ?? 20));
  params.set("offset", String(options?.offset ?? 0));

  return fetchJson<{
    total: number;
    limit: number;
    offset: number;
    experiments: OptimizationExperimentListItem[];
  }>(`${basePath}?${params}`);
}

export function getOptimizationSearchSpace(strategyId: number) {
  return fetchJson<SearchSpacePreview>(`${basePath}/search-space?strategy_id=${strategyId}`);
}

export function getOptimizationExperiment(id: number) {
  return fetchJson<OptimizationExperimentRecord>(`${basePath}/${id}`);
}

export function cancelOptimizationExperiment(id: number) {
  return fetchJson<OptimizationExperimentRecord & { cancel_requested: boolean }>(
    `${basePath}/${id}/cancel`,
    { method: "POST" },
  );
}

export function resumeOptimizationExperiment(id: number) {
  return fetchJson<OptimizationExperimentRecord>(`${basePath}/${id}/resume`, { method: "POST" });
}

export function deleteOptimizationExperiment(id: number) {
  return fetchJson<{ id: number; deleted: boolean }>(`${basePath}/${id}`, { method: "DELETE" });
}

export function listOptimizationTrials(
  experimentId: number,
  options?: { status?: string; eligible?: boolean; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.eligible != null) {
    params.set("eligible", String(options.eligible));
  }
  params.set("limit", String(options?.limit ?? 50));
  params.set("offset", String(options?.offset ?? 0));

  return fetchJson<{ total: number; limit: number; offset: number; trials: OptimizationTrialRecord[] }>(
    `${basePath}/${experimentId}/trials?${params}`,
  );
}

export function getOptimizationTrial(experimentId: number, trialIndex: number) {
  return fetchJson<OptimizationTrialDetail>(`${basePath}/${experimentId}/trials/${trialIndex}`);
}

export function getOptimizationTrialEquity(experimentId: number, trialIndex: number) {
  return fetchJson<TrialEquityResponse>(
    `${basePath}/${experimentId}/trials/${trialIndex}/equity`,
  );
}

export function openOptimizationTrialHoldout(experimentId: number, trialIndex: number) {
  return fetchJson<HoldoutEvaluation>(
    `${basePath}/${experimentId}/trials/${trialIndex}/holdout`,
    { method: "POST" },
  );
}

export function saveOptimizationTrialStrategy(
  experimentId: number,
  trialIndex: number,
  name?: string,
) {
  return fetchJson<StrategyRecord>(`${basePath}/${experimentId}/trials/${trialIndex}/strategies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
}
