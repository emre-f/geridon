import { createHash } from "node:crypto";

import type { Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { labelVersion } from "../forwardReturns.ts";
import type { EventSelectionOptions } from "./eventSelection.ts";

export type SignalVerdict = "no_signal" | "weak" | "candidate";

/**
 * The three numbers every evaluation must surface, whatever else the event
 * study reports: they alone decide the verdict, and the registry summary
 * aggregates them across draws.
 */
export interface SignalHeadlineStats {
  baseline_gap_t_stat: number;
  net_abnormal_return: number;
  n_events: number;
}

/**
 * Fixed constants, not tunables. Candidate demands more than p < 0.05 because
 * the registry counts many draws; weak marks "worth another look", nothing
 * else. Only candidate unlocks holdout + promotion.
 */
export const verdictThresholds = {
  weak: { min_t_stat: 2, min_net_abnormal_return: 0, min_events: 100 },
  candidate: { min_t_stat: 3, min_net_abnormal_return: 0.001, min_events: 500 },
} as const;

export function computeVerdict(stats: SignalHeadlineStats): SignalVerdict {
  const meets = (tier: (typeof verdictThresholds)[keyof typeof verdictThresholds]) =>
    stats.baseline_gap_t_stat >= tier.min_t_stat &&
    stats.net_abnormal_return > tier.min_net_abnormal_return &&
    stats.n_events >= tier.min_events;

  if (meets(verdictThresholds.candidate)) {
    return "candidate";
  }
  if (meets(verdictThresholds.weak)) {
    return "weak";
  }
  return "no_signal";
}

export interface SignalEvaluationInput {
  query: EventSelectionOptions;
  seed: number;
  headline: SignalHeadlineStats;
  detail: unknown;
  versions?: Record<string, number>;
}

export interface SignalEvaluationRow {
  id: number;
  event_kind: EventKind;
  query: EventSelectionOptions;
  event_query_hash: string;
  start_ms: number | null;
  end_ms: number | null;
  seed: number;
  versions: Record<string, number>;
  headline: SignalHeadlineStats;
  detail: unknown;
  verdict: SignalVerdict;
  created_at: string;
  holdout_consumed_at: string | null;
  holdout_results: unknown;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

export function eventQueryHash(query: EventSelectionOptions): string {
  return createHash("sha256").update(JSON.stringify(sortKeys(query))).digest("hex");
}

export function recordEvaluation(db: Database, input: SignalEvaluationInput): SignalEvaluationRow {
  const versions = { label_version: labelVersion, ...input.versions };
  const verdict = computeVerdict(input.headline);
  const result = db
    .prepare(`
      INSERT INTO signal_evaluations
        (event_kind, event_query, event_query_hash, start_ms, end_ms, seed,
         versions, results, verdict)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.query.kind,
      JSON.stringify(input.query),
      eventQueryHash(input.query),
      input.query.startMs ?? null,
      input.query.endMs ?? null,
      input.seed,
      JSON.stringify(versions),
      JSON.stringify({ headline: input.headline, detail: input.detail }),
      verdict,
    );

  const row = getEvaluation(db, Number(result.lastInsertRowid));
  if (row == null) {
    throw new Error("Failed to read back recorded signal evaluation.");
  }
  return row;
}

export function getEvaluation(db: Database, id: number): SignalEvaluationRow | null {
  const row = db.prepare(`${selectEvaluations} WHERE id = ?`).get(id);
  return row == null ? null : parseRow(row);
}

export function listEvaluations(
  db: Database,
  options: { kind?: EventKind } = {},
): SignalEvaluationRow[] {
  const where = options.kind != null ? "WHERE event_kind = ?" : "";
  const parameters = options.kind != null ? [options.kind] : [];
  const rows = db
    .prepare(`${selectEvaluations} ${where} ORDER BY id DESC`)
    .all(...parameters);
  return rows.map(parseRow);
}

/**
 * The holdout is consumable exactly once per evaluation, and only a candidate
 * verdict unlocks it — both enforced here so no caller can re-run a failed
 * holdout check until it passes.
 */
export function consumeHoldout(
  db: Database,
  id: number,
  holdoutResults: unknown,
): SignalEvaluationRow {
  const existing = getEvaluation(db, id);
  if (existing == null) {
    throw new Error(`Signal evaluation ${id} not found.`);
  }
  if (existing.verdict !== "candidate") {
    throw new Error(
      `Holdout is only consumable on a candidate verdict; evaluation ${id} is ${existing.verdict}.`,
    );
  }
  if (existing.holdout_consumed_at != null) {
    throw new Error(`Holdout for evaluation ${id} was already consumed at ${existing.holdout_consumed_at}.`);
  }

  db.prepare(`
    UPDATE signal_evaluations
    SET holdout_consumed_at = CURRENT_TIMESTAMP, holdout_results = ?
    WHERE id = ? AND holdout_consumed_at IS NULL
  `).run(JSON.stringify(holdoutResults), id);

  const updated = getEvaluation(db, id);
  if (updated == null || updated.holdout_consumed_at == null) {
    throw new Error(`Holdout for evaluation ${id} was consumed concurrently.`);
  }
  return updated;
}

const selectEvaluations = `
  SELECT id, event_kind, event_query, event_query_hash, start_ms, end_ms, seed,
         versions, results, verdict, created_at, holdout_consumed_at, holdout_results
  FROM signal_evaluations
`;

function parseRow(row: Record<string, unknown>): SignalEvaluationRow {
  const results = JSON.parse(String(row.results)) as {
    headline: SignalHeadlineStats;
    detail: unknown;
  };
  return {
    id: Number(row.id),
    event_kind: String(row.event_kind) as EventKind,
    query: JSON.parse(String(row.event_query)) as EventSelectionOptions,
    event_query_hash: String(row.event_query_hash),
    start_ms: row.start_ms == null ? null : Number(row.start_ms),
    end_ms: row.end_ms == null ? null : Number(row.end_ms),
    seed: Number(row.seed),
    versions: JSON.parse(String(row.versions)) as Record<string, number>,
    headline: results.headline,
    detail: results.detail,
    verdict: String(row.verdict) as SignalVerdict,
    created_at: String(row.created_at),
    holdout_consumed_at: row.holdout_consumed_at == null ? null : String(row.holdout_consumed_at),
    holdout_results:
      row.holdout_results == null ? null : JSON.parse(String(row.holdout_results)),
  };
}
