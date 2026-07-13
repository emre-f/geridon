import type { Database } from "../../db.ts";
import type {
  OptimizationExperimentProgress,
  OptimizationExperimentStatus,
  OptimizationExperimentSummary,
  OptimizationResult,
  OptimizationTrial,
  OptimizationTrialDetail,
  OptimizationTrialRecord,
} from "../../types.ts";
import { trialRecord, type Row } from "./experimentRows.ts";

const upsertTrialSql = `
  INSERT INTO optimization_trials (
    experiment_id, trial_index, hash, phase, status, rejection_reason, stage_reached,
    leaderboard_rank, eligible, score, score_detail, trial_values, strategy, complexity,
    fold_results
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(experiment_id, trial_index) DO UPDATE SET
    status = excluded.status,
    rejection_reason = excluded.rejection_reason,
    stage_reached = excluded.stage_reached,
    leaderboard_rank = excluded.leaderboard_rank,
    eligible = excluded.eligible,
    score = excluded.score,
    score_detail = excluded.score_detail,
    strategy = excluded.strategy,
    fold_results = excluded.fold_results
`;

function trialRowParams(
  experimentId: number,
  trial: OptimizationTrial,
  rank: number | null,
): Array<number | string | null> {
  const rejected = trial.status === "rejected";
  return [
    experimentId,
    trial.index,
    trial.hash,
    trial.phase,
    trial.status,
    trial.rejectionReason ?? null,
    trial.stageReached,
    rank,
    trial.score == null ? null : trial.score.eligible ? 1 : 0,
    trial.score?.score ?? null,
    trial.score == null ? null : JSON.stringify(trial.score),
    JSON.stringify(trial.values),
    rejected ? null : JSON.stringify(trial.strategy),
    JSON.stringify(trial.complexity),
    rejected ? null : JSON.stringify(trial.foldResults),
  ];
}

/**
 * Streams one finished trial to the database while its experiment is still
 * running, so a crash or restart never loses completed work. The final
 * persistExperimentResult pass upserts the same rows to fill in ranks.
 */
export function upsertTrialRow(db: Database, experimentId: number, trial: OptimizationTrial) {
  db.prepare(upsertTrialSql).run(...trialRowParams(experimentId, trial, null));
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
  const now = Date.now();
  const progress: OptimizationExperimentProgress = {
    evaluated_trials: counts.total,
    max_trials: maxTrials,
    updated_at_ms: now,
    started_at_ms: now - elapsedMs,
    scored: counts.scored,
    pruned: counts.pruned,
    rejected: counts.rejected,
    phase: result.trials.some((trial) => trial.phase === "refine") ? "refine" : "search",
    baseline_score: result.baseline.score.score,
  };

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE optimization_experiments
       SET status = ?, summary = ?, progress = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(status, JSON.stringify(summary), JSON.stringify(progress), id);
    const upsert = db.prepare(upsertTrialSql);
    for (const trial of result.trials) {
      upsert.run(...trialRowParams(id, trial, ranks.get(trial.index) ?? null));
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
