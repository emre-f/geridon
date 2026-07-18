import { fetchJson } from "@/lib/api-client";

const basePath = "/api/v1/signals";

export const signalEventKinds = ["insider_buy", "insider_sell", "insider_cluster_buy"] as const;
export type SignalEventKind = (typeof signalEventKinds)[number];

/** Events from this date onward are sealed for the one-shot holdout check. */
export const signalHoldoutStartMs = Date.UTC(2025, 0, 1);

export interface SignalUniverseFilters {
  min_price?: number;
  min_median_dollar_volume?: number;
}

export interface SignalEventQuery {
  kind: SignalEventKind;
  min_score?: number;
  payload_filters?: Record<string, number>;
  universe?: SignalUniverseFilters;
  start_ms?: number;
  end_ms?: number;
}

export interface SignalSelectionStats {
  candidates: number;
  selected: number;
  tickers: number;
  holdout_clamped: boolean;
  excluded: {
    min_score: number;
    payload_filters: number;
    no_anchor: number;
    insufficient_history: number;
    below_min_price: number;
    below_min_dollar_volume: number;
  };
}

export type SignalJobType = "evaluation" | "holdout";

export type SignalJobStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

/**
 * The stored request echoes the backend's parsed query, which uses camelCase
 * keys, unlike the snake_case request body this client sends.
 */
export interface SignalJobStoredRequest {
  query?: {
    kind: SignalEventKind;
    minScore?: number;
    payloadFilters?: Record<string, number>;
    universe?: { minPrice?: number; minMedianDollarVolume?: number };
    startMs?: number;
    endMs?: number;
  };
  seed?: number;
  evaluation_id?: number;
}

export interface SignalJobRow {
  id: number;
  job_type: SignalJobType;
  request: SignalJobStoredRequest;
  status: SignalJobStatus;
  selection_stats: SignalSelectionStats | null;
  error: string | null;
  evaluation_id: number | null;
  created_at: string;
  updated_at: string;
}

export function previewSignalSelection(query: SignalEventQuery) {
  return fetchJson<{ stats: SignalSelectionStats }>(`${basePath}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(query),
  });
}

export function createSignalEvaluation(input: SignalEventQuery & { seed?: number }) {
  return fetchJson<SignalJobRow>(`${basePath}/evaluations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function listSignalJobs(limit = 20) {
  return fetchJson<{ jobs: SignalJobRow[] }>(`${basePath}/jobs?limit=${limit}`);
}

export function getSignalJob(id: number) {
  return fetchJson<SignalJobRow>(`${basePath}/jobs/${id}`);
}
