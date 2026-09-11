import { fetchJson } from "@/lib/api-client";
import { withRecordNodeIds } from "@/lib/api-client-strategies";
import type { StrategyRecord } from "@/lib/api-strategy-types";

const basePath = "/api/v1/signals";

export interface SignalHoldoutJob {
  id: number;
  job_type: "evaluation" | "holdout";
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  evaluation_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function runSignalHoldoutCheck(evaluationId: number) {
  return fetchJson<SignalHoldoutJob>(`${basePath}/evaluations/${evaluationId}/holdout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export interface PromoteSignalEvaluationResponse {
  evaluation_id: number;
  strategy: StrategyRecord;
}

export async function promoteSignalEvaluation(
  evaluationId: number,
  options: { name?: string; trendFilter?: boolean } = {},
) {
  const response = await fetchJson<PromoteSignalEvaluationResponse>(
    `${basePath}/evaluations/${evaluationId}/promote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(options.name != null ? { name: options.name } : {}),
        ...(options.trendFilter != null ? { trend_filter: options.trendFilter } : {}),
      }),
    },
  );
  return { ...response, strategy: withRecordNodeIds(response.strategy) };
}
