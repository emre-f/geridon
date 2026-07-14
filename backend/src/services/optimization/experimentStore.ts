import type { Database } from "../../db.ts";
import type {
  HoldoutEvaluation,
  OptimizationExperimentConfig,
  OptimizationExperimentListItem,
  OptimizationExperimentProgress,
  OptimizationExperimentRecord,
  OptimizationExperimentSnapshot,
  OptimizationExperimentStatus,
} from "../../types.ts";
import { experimentListItem, experimentRecord, type Row } from "./experimentRows.ts";

export function insertExperiment(
  db: Database,
  config: OptimizationExperimentConfig,
  snapshot: OptimizationExperimentSnapshot,
): OptimizationExperimentRecord {
  const inserted = db
    .prepare(
      "INSERT INTO optimization_experiments (strategy_id, status, config, snapshot) VALUES (?, 'queued', ?, ?)",
    )
    .run(config.strategy_id, JSON.stringify(config), JSON.stringify(snapshot));
  return getExperiment(db, Number(inserted.lastInsertRowid))!;
}

export function getExperiment(db: Database, id: number): OptimizationExperimentRecord | null {
  const row = db.prepare("SELECT * FROM optimization_experiments WHERE id = ?").get(id);
  return row ? experimentRecord(row) : null;
}

export function listExperiments(
  db: Database,
  options: { status?: OptimizationExperimentStatus; limit: number; offset: number },
): { total: number; experiments: OptimizationExperimentListItem[] } {
  const where = options.status ? "WHERE status = ?" : "";
  const params = options.status ? [options.status] : [];
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM optimization_experiments ${where}`).get(...params) as Row)
      .count,
  );
  const rows = db
    .prepare(
      `SELECT * FROM optimization_experiments ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset);
  return { total, experiments: rows.map(experimentListItem) };
}

export function updateExperimentStatus(
  db: Database,
  id: number,
  status: OptimizationExperimentStatus,
  error?: string,
) {
  db.prepare(
    "UPDATE optimization_experiments SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(status, error ?? null, id);
}

export function updateExperimentProgress(
  db: Database,
  id: number,
  progress: OptimizationExperimentProgress,
) {
  db.prepare(
    "UPDATE optimization_experiments SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(JSON.stringify(progress), id);
}

/**
 * Existing trial rows are kept: the runner reads them as the resume checkpoint
 * and clears them right before the resumed run starts streaming fresh rows.
 */
export function resetExperimentForResume(db: Database, id: number) {
  db.prepare(
    `UPDATE optimization_experiments
     SET status = 'queued', progress = NULL, summary = NULL, error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(id);
}

export function setExperimentHoldout(db: Database, id: number, evaluation: HoldoutEvaluation) {
  db.prepare(
    "UPDATE optimization_experiments SET holdout = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(JSON.stringify(evaluation), id);
}

export function deleteExperiment(db: Database, id: number): boolean {
  return Number(db.prepare("DELETE FROM optimization_experiments WHERE id = ?").run(id).changes) > 0;
}
