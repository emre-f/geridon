import { fetchJson } from "@/lib/api-client";

const basePath = "/api/v1/signals";

export interface EventCoverageRow {
  event_kind: string;
  year: number;
  events: number;
}

export interface EventIngestionRecord {
  id: number;
  source: string;
  start_ms: number;
  end_ms: number;
  status: string;
  inserted_rows: number;
  skipped_rows: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface SignalCoverageResponse {
  coverage: EventCoverageRow[];
  ingestions: EventIngestionRecord[];
}

export function fetchSignalCoverage() {
  return fetchJson<SignalCoverageResponse>(`${basePath}/coverage`);
}
