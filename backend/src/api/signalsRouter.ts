import type { IncomingMessage } from "node:http";

import type { Database } from "../db.ts";
import { readJson } from "../http.ts";
import type { SignalEvaluationRunner } from "../services/signalEval/evaluationRunner.ts";
import {
  handleCreateSignalEvaluation,
  handleGetSignalCoverage,
  handleGetSignalEvaluation,
  handleGetSignalJob,
  handleGetSignalRegistrySummary,
  handleListSignalEvaluations,
  handleListSignalJobs,
  handlePreviewSignalSelection,
  handlePromoteSignalEvaluation,
  handleRunSignalHoldout,
} from "./signals.ts";
import type { ApiResult } from "./shared.ts";

const basePath = "/api/v1/signals";

/** Signal Lab endpoints; bare POST /api/v1/signals (strategy signals) stays elsewhere. */
export async function routeSignals(
  db: Database,
  runner: SignalEvaluationRunner,
  request: IncomingMessage,
  url: URL,
): Promise<ApiResult | null> {
  const { pathname } = url;
  const method = request.method;
  if (!pathname.startsWith(`${basePath}/`)) {
    return null;
  }

  if (pathname === `${basePath}/coverage` && method === "GET") {
    return handleGetSignalCoverage(db);
  }

  if (pathname === `${basePath}/preview` && method === "POST") {
    return handlePreviewSignalSelection(db, await readJson(request));
  }

  if (pathname === `${basePath}/summary` && method === "GET") {
    return handleGetSignalRegistrySummary(db);
  }

  if (pathname === `${basePath}/evaluations`) {
    if (method === "GET") {
      return handleListSignalEvaluations(db, url.searchParams);
    }
    if (method === "POST") {
      return handleCreateSignalEvaluation(db, runner, await readJson(request));
    }
    return null;
  }

  const holdoutMatch = pathname.match(/^\/api\/v1\/signals\/evaluations\/(\d+)\/holdout$/);
  if (holdoutMatch && method === "POST") {
    return handleRunSignalHoldout(db, runner, holdoutMatch[1], await readJson(request));
  }

  const promoteMatch = pathname.match(/^\/api\/v1\/signals\/evaluations\/(\d+)\/promote$/);
  if (promoteMatch && method === "POST") {
    return handlePromoteSignalEvaluation(db, promoteMatch[1], await readJson(request));
  }

  const evaluationMatch = pathname.match(/^\/api\/v1\/signals\/evaluations\/(\d+)$/);
  if (evaluationMatch && method === "GET") {
    return handleGetSignalEvaluation(db, evaluationMatch[1]);
  }

  if (pathname === `${basePath}/jobs` && method === "GET") {
    return handleListSignalJobs(db, url.searchParams);
  }

  const jobMatch = pathname.match(/^\/api\/v1\/signals\/jobs\/(\d+)$/);
  if (jobMatch && method === "GET") {
    return handleGetSignalJob(db, jobMatch[1]);
  }

  return null;
}
