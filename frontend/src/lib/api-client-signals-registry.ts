import { fetchJson } from "@/lib/api-client";

const basePath = "/api/v1/signals";

export type SignalVerdict = "no_signal" | "weak" | "candidate";

export interface SignalHeadlineStats {
  baseline_gap_t_stat: number;
  net_abnormal_return: number;
  n_events: number;
}

export interface SignalUniverseFilters {
  minPrice?: number;
  minMedianDollarVolume?: number;
}

export interface SignalEventQuery {
  kind: string;
  minScore?: number;
  payloadFilters?: Record<string, number>;
  universe?: SignalUniverseFilters;
  startMs?: number;
  endMs?: number;
}

export interface EventStudyPoint {
  horizon: number;
  signal_mean: number | null;
  signal_events: number;
  baseline_mean: number | null;
  baseline_events: number;
  gap: number | null;
  gap_lower: number | null;
  gap_upper: number | null;
  gap_t_stat: number | null;
}

export interface EventStudyResult {
  n_events: number;
  n_tickers: number;
  seed: number;
  bootstrap_iterations: number;
  events_per_year: Array<{ year: number; count: number }>;
  curve: EventStudyPoint[];
}

export interface HorizonSummaryRow {
  horizon: number;
  signal_mean: number | null;
  baseline_mean: number | null;
  abnormal: number | null;
}

export interface HorizonSummary {
  rows: HorizonSummaryRow[];
  natural_holding_period_bars: number | null;
  peak_gap: number | null;
}

export interface CostLineRow {
  horizon: number;
  abnormal: number | null;
  net_abnormal: number | null;
}

export interface CostLine {
  round_trip_cost: number;
  rows: CostLineRow[];
  headline_horizon: number | null;
  gross_abnormal_return: number | null;
  net_abnormal_return: number | null;
}

export interface BucketStudy {
  label: string;
  n_events: number;
  min_score: number | null;
  max_score: number | null;
  reference_gap: number | null;
  peak_gap: number | null;
  natural_holding_period_bars: number | null;
}

export interface FlagSplit {
  field: string;
  with_flag: BucketStudy;
  without_flag: BucketStudy;
  missing_events: number;
}

export interface ScoreAnalysis {
  reference_horizon: number;
  unscored_events: number;
  score_buckets: BucketStudy[];
  monotonic_in_score: boolean | null;
  flag_splits: FlagSplit[];
}

export interface EventSelectionStats {
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

export interface SignalEvaluationDetail {
  selection: EventSelectionStats;
  study: EventStudyResult;
  horizon_summary: HorizonSummary;
  cost_line: CostLine;
  score_analysis: ScoreAnalysis;
}

export interface SignalHoldoutResults {
  headline: SignalHeadlineStats;
  verdict: SignalVerdict;
  detail: SignalEvaluationDetail;
}

export interface SignalEvaluationListItem {
  id: number;
  event_kind: string;
  query: SignalEventQuery;
  seed: number;
  verdict: SignalVerdict;
  headline: SignalHeadlineStats;
  created_at: string;
  holdout_consumed_at: string | null;
}

export interface SignalEvaluationRecord {
  id: number;
  event_kind: string;
  query: SignalEventQuery;
  event_query_hash: string;
  start_ms: number | null;
  end_ms: number | null;
  seed: number;
  versions: Record<string, number>;
  headline: SignalHeadlineStats;
  detail: SignalEvaluationDetail | null;
  verdict: SignalVerdict;
  created_at: string;
  holdout_consumed_at: string | null;
  holdout_results: SignalHoldoutResults | null;
}

export interface RegistryKindSummary {
  event_kind: string;
  evaluations: number;
  verdicts: Record<SignalVerdict, number>;
  best_t_stat: number | null;
  median_t_stat: number | null;
  best_net_abnormal_return: number | null;
  median_net_abnormal_return: number | null;
  holdouts_consumed: number;
}

export interface RegistrySummary {
  total_draws: number;
  expected_lucky: number;
  kinds: RegistryKindSummary[];
}

export function fetchSignalEvaluations(kind?: string) {
  const suffix = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return fetchJson<{ evaluations: SignalEvaluationListItem[] }>(
    `${basePath}/evaluations${suffix}`,
  );
}

export function fetchSignalEvaluation(id: number) {
  return fetchJson<SignalEvaluationRecord>(`${basePath}/evaluations/${id}`);
}

export function fetchSignalRegistrySummary() {
  return fetchJson<RegistrySummary>(`${basePath}/summary`);
}
