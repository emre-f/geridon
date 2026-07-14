import type { IncomingMessage } from "node:http";

import type { Database } from "../db.ts";
import { readJson } from "../http.ts";
import type { ExperimentRunner } from "../services/optimization/experimentRunner.ts";
import {
  experimentForPath,
  handleCancelExperiment,
  handleCreateExperiment,
  handleDeleteExperiment,
  handleGetExperiment,
  handleListExperiments,
  handleResumeExperiment,
} from "./optimizationExperiments.ts";
import { handleOpenTrialHoldout } from "./optimizationHoldout.ts";
import { handlePreflightExperiment } from "./optimizationPreflight.ts";
import { handleGetRuleLibrary } from "./optimizationRuleLibrary.ts";
import { handleGetSearchSpacePreview } from "./optimizationSearchSpace.ts";
import {
  handleGetExperimentTrial,
  handleGetTrialEquity,
  handleListExperimentTrials,
  handleSaveTrialStrategy,
} from "./optimizationTrials.ts";
import type { ApiResult } from "./shared.ts";

const basePath = "/api/v1/optimization-experiments";

export async function routeOptimizationExperiments(
  db: Database,
  runner: ExperimentRunner,
  request: IncomingMessage,
  url: URL,
): Promise<ApiResult | null> {
  const { pathname } = url;
  const method = request.method;
  if (!pathname.startsWith(basePath)) {
    return null;
  }

  if (pathname === basePath) {
    if (method === "GET") {
      return handleListExperiments(db, url.searchParams);
    }
    if (method === "POST") {
      return handleCreateExperiment(db, runner, await readJson(request));
    }
    return null;
  }

  if (pathname === `${basePath}/search-space` && method === "GET") {
    return handleGetSearchSpacePreview(db, url.searchParams);
  }

  if (pathname === `${basePath}/rule-library` && method === "GET") {
    return handleGetRuleLibrary(db, url.searchParams.get("strategy_id"));
  }

  if (pathname === `${basePath}/preflight` && method === "POST") {
    return handlePreflightExperiment(db, await readJson(request));
  }

  const idMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)$`));
  if (idMatch) {
    if (method === "GET") {
      return handleGetExperiment(db, idMatch[1]);
    }
    if (method === "DELETE") {
      return handleDeleteExperiment(db, runner, idMatch[1]);
    }
    return null;
  }

  const actionMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/(cancel|resume)$`));
  if (actionMatch && method === "POST") {
    return actionMatch[2] === "cancel"
      ? handleCancelExperiment(db, runner, actionMatch[1])
      : handleResumeExperiment(db, runner, actionMatch[1]);
  }

  const trialsMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/trials$`));
  const trialMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/trials/(\\d+)$`));
  const saveMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/trials/(\\d+)/strategies$`));
  const equityMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/trials/(\\d+)/equity$`));
  const holdoutMatch = pathname.match(new RegExp(`^${basePath}/(\\d+)/trials/(\\d+)/holdout$`));
  const experimentPath = (trialsMatch ?? trialMatch ?? saveMatch ?? equityMatch ?? holdoutMatch)?.[1];
  if (experimentPath) {
    const resolved = experimentForPath(db, experimentPath);
    if ("failure" in resolved) {
      return resolved.failure;
    }
    if (trialsMatch && method === "GET") {
      return handleListExperimentTrials(db, resolved.experiment, url.searchParams);
    }
    if (trialMatch && method === "GET") {
      return handleGetExperimentTrial(db, resolved.experiment, trialMatch[2]);
    }
    if (equityMatch && method === "GET") {
      return handleGetTrialEquity(db, resolved.experiment, equityMatch[2]);
    }
    if (holdoutMatch && method === "POST") {
      return handleOpenTrialHoldout(db, resolved.experiment, holdoutMatch[2]);
    }
    if (saveMatch && method === "POST") {
      const body = await readJson(request).catch(() => ({}));
      return handleSaveTrialStrategy(db, resolved.experiment, saveMatch[2], body);
    }
  }

  return null;
}
