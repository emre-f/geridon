import type { Database } from "../../db.ts";
import type { TradeCosts } from "../../types/backtests.ts";
import type { EventSelectionOptions, EventSelectionStats } from "./eventSelection.ts";

export type SignalJobType = "evaluation" | "holdout";

export type SignalJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

/**
 * An evaluation job carries the full query; a holdout job carries only the
 * evaluation id it consumes (query and seed come from the registry row) plus
 * the cost settings for the holdout's net-of-cost headline.
 */
export interface SignalJobRequest {
  query?: EventSelectionOptions;
  seed?: number;
  evaluation_id?: number;
  costs: TradeCosts;
  notional_per_event?: number;
  bootstrap_iterations?: number;
}

export interface SignalJobRow {
  id: number;
  job_type: SignalJobType;
  request: SignalJobRequest;
  status: SignalJobStatus;
  selection_stats: EventSelectionStats | null;
  error: string | null;
  evaluation_id: number | null;
  created_at: string;
  updated_at: string;
}

export function insertJob(
  db: Database,
  jobType: SignalJobType,
  request: SignalJobRequest,
): SignalJobRow {
  const result = db
    .prepare("INSERT INTO signal_evaluation_jobs (job_type, request) VALUES (?, ?)")
    .run(jobType, JSON.stringify(request));
  const row = getJob(db, Number(result.lastInsertRowid));
  if (row == null) {
    throw new Error("Failed to read back inserted signal evaluation job.");
  }
  return row;
}

export function getJob(db: Database, id: number): SignalJobRow | null {
  const row = db.prepare(`${selectJobs} WHERE id = ?`).get(id);
  return row == null ? null : parseRow(row);
}

export function listJobs(db: Database, options: { limit?: number } = {}): SignalJobRow[] {
  const rows = db
    .prepare(`${selectJobs} ORDER BY id DESC LIMIT ?`)
    .all(options.limit ?? 20);
  return rows.map(parseRow);
}

export function markJobStatus(
  db: Database,
  id: number,
  status: SignalJobStatus,
  options: {
    error?: string;
    evaluationId?: number;
    selectionStats?: EventSelectionStats;
  } = {},
): void {
  db.prepare(`
    UPDATE signal_evaluation_jobs
    SET status = ?,
        error = ?,
        evaluation_id = COALESCE(?, evaluation_id),
        selection_stats = COALESCE(?, selection_stats),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status,
    options.error ?? null,
    options.evaluationId ?? null,
    options.selectionStats == null ? null : JSON.stringify(options.selectionStats),
    id,
  );
}

/** Boot recovery: running jobs died with the process; queued ones re-enqueue. */
export function recoverJobs(db: Database): number[] {
  db.prepare(`
    UPDATE signal_evaluation_jobs
    SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
  `).run();
  const rows = db
    .prepare("SELECT id FROM signal_evaluation_jobs WHERE status = 'queued' ORDER BY id ASC")
    .all();
  return rows.map((row) => Number(row.id));
}

const selectJobs = `
  SELECT id, job_type, request, status, selection_stats, error,
         evaluation_id, created_at, updated_at
  FROM signal_evaluation_jobs
`;

function parseRow(row: Record<string, unknown>): SignalJobRow {
  return {
    id: Number(row.id),
    job_type: String(row.job_type) as SignalJobType,
    request: JSON.parse(String(row.request)) as SignalJobRequest,
    status: String(row.status) as SignalJobStatus,
    selection_stats:
      row.selection_stats == null
        ? null
        : (JSON.parse(String(row.selection_stats)) as EventSelectionStats),
    error: row.error == null ? null : String(row.error),
    evaluation_id: row.evaluation_id == null ? null : Number(row.evaluation_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
