import type { Database } from "../db.ts";
import { getEventCoverage } from "../services/eventStore.ts";
import { selectEvents } from "../services/signalEval/eventSelection.ts";
import {
  getJob,
  insertJob,
  listJobs,
} from "../services/signalEval/evaluationJobStore.ts";
import type { SignalEvaluationRunner } from "../services/signalEval/evaluationRunner.ts";
import {
  getEvaluation,
  listEvaluations,
  type SignalEvaluationRow,
} from "../services/signalEval/registry.ts";
import { getRegistrySummary } from "../services/signalEval/registrySummary.ts";
import { buildStarterStrategy } from "../services/signalEval/promotion.ts";
import { isEventKind, type EventKind } from "../types/events.ts";
import {
  parseEvaluationRequest,
  parseEventQuery,
  parseHoldoutRequest,
  parsePromotionRequest,
} from "./signalRequests.ts";
import { badRequest, parsePositiveId, type ApiResult } from "./shared.ts";
import { handleCreateStrategy } from "./strategies.ts";

export function handleGetSignalCoverage(db: Database): ApiResult {
  const ingestions = db
    .prepare(`
      SELECT id, source, start_ms, end_ms, status, inserted_rows, skipped_rows,
             error, started_at, finished_at
      FROM event_ingestions
      ORDER BY id DESC
      LIMIT 20
    `)
    .all()
    .map((row) => ({
      id: Number(row.id),
      source: String(row.source),
      start_ms: Number(row.start_ms),
      end_ms: Number(row.end_ms),
      status: String(row.status),
      inserted_rows: Number(row.inserted_rows),
      skipped_rows: Number(row.skipped_rows),
      error: row.error == null ? null : String(row.error),
      started_at: String(row.started_at),
      finished_at: row.finished_at == null ? null : String(row.finished_at),
    }));

  return { statusCode: 200, body: { coverage: getEventCoverage(db), ingestions } };
}

/** The evaluation form's live "N events, M tickers" preview: selection only. */
export function handlePreviewSignalSelection(db: Database, body: unknown): ApiResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const query = parseEventQuery(body as Record<string, unknown>);
  if ("error" in query) {
    return badRequest(query.error);
  }
  const { stats } = selectEvents(db, query.value);
  return { statusCode: 200, body: { stats } };
}

export function handleCreateSignalEvaluation(
  db: Database,
  runner: SignalEvaluationRunner,
  body: unknown,
): ApiResult {
  const parsed = parseEvaluationRequest(body);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }
  const job = insertJob(db, "evaluation", parsed.value);
  runner.enqueue(job.id);
  return { statusCode: 201, body: job };
}

export function handleRunSignalHoldout(
  db: Database,
  runner: SignalEvaluationRunner,
  idPath: string,
  body: unknown,
): ApiResult {
  const resolved = evaluationForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  const { evaluation } = resolved;
  if (evaluation.verdict !== "candidate") {
    return {
      statusCode: 409,
      body: { detail: `Holdout requires a candidate verdict; evaluation ${evaluation.id} is ${evaluation.verdict}.` },
    };
  }
  if (evaluation.holdout_consumed_at != null) {
    return {
      statusCode: 409,
      body: { detail: `Holdout for evaluation ${evaluation.id} was already consumed at ${evaluation.holdout_consumed_at}.` },
    };
  }

  const parsed = parseHoldoutRequest(evaluation.id, body);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }
  const job = insertJob(db, "holdout", parsed.value);
  runner.enqueue(job.id);
  return { statusCode: 202, body: job };
}

/**
 * Promotion: a candidate evaluation becomes a starter strategy saved through
 * the normal strategy pipeline, so it shows up in the Strategies tab like any
 * hand-built one. Entry is the validated event trigger, exit is time-based at
 * the measured natural holding period.
 */
export function handlePromoteSignalEvaluation(db: Database, idPath: string, body: unknown): ApiResult {
  const resolved = evaluationForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  const { evaluation } = resolved;
  if (evaluation.verdict !== "candidate") {
    return {
      statusCode: 409,
      body: { detail: `Promotion requires a candidate verdict; evaluation ${evaluation.id} is ${evaluation.verdict}.` },
    };
  }

  const parsed = parsePromotionRequest(body);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }
  const built = buildStarterStrategy(evaluation, parsed.value);
  if ("error" in built) {
    return { statusCode: 409, body: { detail: built.error } };
  }

  const created = handleCreateStrategy(db, built.strategy);
  if (created.statusCode !== 201) {
    return created;
  }
  return { statusCode: 201, body: { evaluation_id: evaluation.id, strategy: created.body } };
}

export function handleListSignalEvaluations(
  db: Database,
  searchParams: URLSearchParams,
): ApiResult {
  const kindParam = searchParams.get("kind");
  if (kindParam != null && !isEventKind(kindParam)) {
    return badRequest("kind must be a known event kind.");
  }
  const evaluations = listEvaluations(db, kindParam ? { kind: kindParam as EventKind } : {});
  return {
    statusCode: 200,
    body: { evaluations: evaluations.map(evaluationListItem) },
  };
}

export function handleGetSignalEvaluation(db: Database, idPath: string): ApiResult {
  const resolved = evaluationForPath(db, idPath);
  if ("failure" in resolved) {
    return resolved.failure;
  }
  return { statusCode: 200, body: resolved.evaluation };
}

export function handleGetSignalRegistrySummary(db: Database): ApiResult {
  return { statusCode: 200, body: getRegistrySummary(db) };
}

export function handleListSignalJobs(db: Database, searchParams: URLSearchParams): ApiResult {
  const limit = Number(searchParams.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badRequest("limit must be an integer between 1 and 100.");
  }
  return { statusCode: 200, body: { jobs: listJobs(db, { limit }) } };
}

export function handleGetSignalJob(db: Database, idPath: string): ApiResult {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Job id must be a positive integer.");
  }
  const job = getJob(db, id);
  if (job == null) {
    return { statusCode: 404, body: { detail: `Signal evaluation job ${id} was not found.` } };
  }
  return { statusCode: 200, body: job };
}

function evaluationForPath(
  db: Database,
  idPath: string,
): { evaluation: SignalEvaluationRow } | { failure: ApiResult } {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return { failure: badRequest("Evaluation id must be a positive integer.") };
  }
  const evaluation = getEvaluation(db, id);
  if (evaluation == null) {
    return { failure: { statusCode: 404, body: { detail: `Signal evaluation ${id} was not found.` } } };
  }
  return { evaluation };
}

/** The list view stays light: verdict and headline, never the full detail package. */
function evaluationListItem(evaluation: SignalEvaluationRow) {
  return {
    id: evaluation.id,
    event_kind: evaluation.event_kind,
    query: evaluation.query,
    seed: evaluation.seed,
    verdict: evaluation.verdict,
    headline: evaluation.headline,
    created_at: evaluation.created_at,
    holdout_consumed_at: evaluation.holdout_consumed_at,
  };
}
