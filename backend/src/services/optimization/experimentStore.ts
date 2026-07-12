import type { Database } from "../../db.ts";
import type {
  OptimizationExperimentConfig,
  OptimizationExperimentListItem,
  OptimizationExperimentProgress,
  OptimizationExperimentRecord,
  OptimizationExperimentSnapshot,
  OptimizationExperimentStatus,
  OptimizationExperimentSummary,
  OptimizationResult,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "../../types.ts";
import { experimentListItem, experimentRecord, trialRecord, type Row } from "./experimentRows.ts";

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

export function resetExperimentForResume(db: Database, id: number) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM optimization_trials WHERE experiment_id = ?").run(id);
    db.prepare(
      `UPDATE optimization_experiments
       SET status = 'queued', progress = NULL, summary = NULL, error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteExperiment(db: Database, id: number): boolean {
  return Number(db.prepare("DELETE FROM optimization_experiments WHERE id = ?").run(id).changes) > 0;
}

export function persistExperimentResult(
  db: Database,
  id: number,
  status: OptimizationExperimentStatus,
  result: OptimizationResult,
  elapsedMs: number,
  maxTrials: number,
) {
  const ranks = new Map(result.leaderboard.map((trial, position) => [trial.index, position + 1]));
  const counts = { total: result.trials.length, scored: 0, pruned: 0, rejected: 0 };
  for (const trial of result.trials) {
    if (trial.status === "scored") counts.scored += 1;
    else if (trial.status === "pruned") counts.pruned += 1;
    else if (trial.status === "rejected") counts.rejected += 1;
  }
  const summary: OptimizationExperimentSummary = {
    scoring_version: result.scoringVersion,
    stopped_early: result.stoppedEarly,
    elapsed_ms: elapsedMs,
    baseline: result.baseline,
    buy_hold: result.buyHold,
    space: result.space,
    ablation: result.ablation,
    inclusion: result.inclusion,
    pareto_fronts: result.paretoFronts,
    trial_counts: counts,
    best_trial_index: result.leaderboard[0]?.index ?? null,
  };
  const progress: OptimizationExperimentProgress = {
    evaluated_trials: counts.total,
    max_trials: maxTrials,
    updated_at_ms: Date.now(),
  };

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE optimization_experiments
       SET status = ?, summary = ?, progress = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(status, JSON.stringify(summary), JSON.stringify(progress), id);
    const insert = db.prepare(
      `INSERT INTO optimization_trials (
        experiment_id, trial_index, hash, phase, status, rejection_reason, stage_reached,
        leaderboard_rank, eligible, score, score_detail, trial_values, strategy, complexity,
        fold_results
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const trial of result.trials) {
      const rejected = trial.status === "rejected";
      insert.run(
        id,
        trial.index,
        trial.hash,
        trial.phase,
        trial.status,
        trial.rejectionReason ?? null,
        trial.stageReached,
        ranks.get(trial.index) ?? null,
        trial.score == null ? null : trial.score.eligible ? 1 : 0,
        trial.score?.score ?? null,
        trial.score == null ? null : JSON.stringify(trial.score),
        JSON.stringify(trial.values),
        rejected ? null : JSON.stringify(trial.strategy),
        JSON.stringify(trial.complexity),
        rejected ? null : JSON.stringify(trial.foldResults),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listTrials(
  db: Database,
  experimentId: number,
  options: { status?: string; eligible?: boolean; limit: number; offset: number },
): { total: number; trials: OptimizationTrialRecord[] } {
  const clauses = ["experiment_id = ?"];
  const params: Array<number | string> = [experimentId];
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.eligible != null) {
    clauses.push("eligible = ?");
    params.push(options.eligible ? 1 : 0);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM optimization_trials ${where}`).get(...params) as Row)
      .count,
  );
  const rows = db
    .prepare(
      `SELECT * FROM optimization_trials ${where}
       ORDER BY leaderboard_rank IS NULL, leaderboard_rank ASC, trial_index ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset);
  return { total, trials: rows.map(trialRecord) };
}

export function getTrialDetail(
  db: Database,
  experimentId: number,
  trialIndex: number,
): OptimizationTrialDetail | null {
  const row = db
    .prepare("SELECT * FROM optimization_trials WHERE experiment_id = ? AND trial_index = ?")
    .get(experimentId, trialIndex) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    ...trialRecord(row),
    strategy: row.strategy == null ? null : JSON.parse(String(row.strategy)),
    fold_results: row.fold_results == null ? [] : JSON.parse(String(row.fold_results)),
  };
}
