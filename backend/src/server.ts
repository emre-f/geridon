import { createServer, type ServerResponse } from "node:http";

import {
  handleDeleteBacktest,
  handleGetBacktest,
  handleListBacktests,
  handleListStrategyBacktests,
  handleRunBacktest,
  handleSignals,
} from "./api/backtests.ts";
import {
  handleListCandles,
  handleListIndicatorCatalog,
  handleListIndicators,
  handleSync,
} from "./api/candles.ts";
import {
  handleDeleteChartState,
  handleListChartStates,
  handlePutChartState,
} from "./api/chartStates.ts";
import { loadExperimentDatasets } from "./api/optimizationRequests.ts";
import { routeOptimizationExperiments } from "./api/optimizationRouter.ts";
import type { ApiResult } from "./api/shared.ts";
import { ExperimentRunner } from "./services/optimization/experimentRunner.ts";
import {
  handleCreateStrategy,
  handleDeleteStrategy,
  handleListStrategies,
  handleUpdateStrategy,
  handleValidateStrategy,
} from "./api/strategies.ts";
import {
  handleDeleteSymbol,
  handleListSymbols,
  handleValidateSymbol,
} from "./api/symbols.ts";
import { getSettings } from "./config.ts";
import { createDb, openDatabase } from "./db.ts";
import { sendJson, sendNoContent, readJson } from "./http.ts";
import type { SyncCandlesRequest } from "./types.ts";

const settings = getSettings();
const db = openDatabase(settings.databaseUrl);
createDb(db);
const experimentRunner = new ExperimentRunner(db, (config) => loadExperimentDatasets(db, config));
experimentRunner.recoverOnBoot();

function sendResult(response: ServerResponse, result: ApiResult) {
  sendJson(response, result.statusCode, result.body);
}

function statusCodeForError(error: unknown, message: string) {
  if (
    error instanceof SyntaxError ||
    message.startsWith("Request body must") ||
    message.startsWith("Unsupported timeframe") ||
    message.startsWith("Invalid datetime") ||
    message.startsWith("start and end query") ||
    message.startsWith("limit must") ||
    message.startsWith("start must") ||
    message.startsWith("Sync currently") ||
    message.startsWith("Yahoo sync supports")
  ) {
    return 400;
  }

  if (
    message.startsWith("Polygon request failed") ||
    message.startsWith("Yahoo Finance request failed")
  ) {
    return 502;
  }

  return 500;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/symbols") {
      sendResult(response, handleListSymbols(db));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/indicators") {
      sendResult(response, handleListIndicatorCatalog());
      return;
    }

    const symbolValidationMatch = url.pathname.match(/^\/api\/v1\/symbols\/([^/]+)\/validate$/);
    if (request.method === "GET" && symbolValidationMatch) {
      sendResult(response, await handleValidateSymbol(db, settings, symbolValidationMatch[1]));
      return;
    }

    const symbolMatch = url.pathname.match(/^\/api\/v1\/symbols\/([^/]+)$/);
    if (request.method === "DELETE" && symbolMatch) {
      sendResult(response, handleDeleteSymbol(db, symbolMatch[1]));
      return;
    }

    if (url.pathname === "/api/v1/strategies") {
      if (request.method === "GET") {
        sendResult(response, handleListStrategies(db));
        return;
      }
      if (request.method === "POST") {
        sendResult(response, handleCreateStrategy(db, await readJson(request)));
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/strategies/validate") {
      sendResult(response, handleValidateStrategy(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/signals") {
      sendResult(response, handleSignals(db, await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/backtests") {
      sendResult(response, handleRunBacktest(db, await readJson(request)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/backtests") {
      sendResult(response, handleListBacktests(db));
      return;
    }

    const strategyBacktestsMatch = url.pathname.match(/^\/api\/v1\/strategies\/(\d+)\/backtests$/);
    if (request.method === "GET" && strategyBacktestsMatch) {
      sendResult(response, handleListStrategyBacktests(db, strategyBacktestsMatch[1]));
      return;
    }

    const backtestMatch = url.pathname.match(/^\/api\/v1\/backtests\/(\d+)$/);
    if (backtestMatch) {
      if (request.method === "GET") {
        sendResult(response, handleGetBacktest(db, backtestMatch[1]));
        return;
      }
      if (request.method === "DELETE") {
        sendResult(response, handleDeleteBacktest(db, backtestMatch[1]));
        return;
      }
    }

    const strategyMatch = url.pathname.match(/^\/api\/v1\/strategies\/(\d+)$/);
    if (strategyMatch) {
      if (request.method === "PUT") {
        sendResult(response, handleUpdateStrategy(db, strategyMatch[1], await readJson(request)));
        return;
      }
      if (request.method === "DELETE") {
        sendResult(response, handleDeleteStrategy(db, strategyMatch[1]));
        return;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/v1/chart-states") {
      sendResult(response, handleListChartStates(db));
      return;
    }

    const chartStateMatch = url.pathname.match(/^\/api\/v1\/chart-states\/([^/]+)$/);
    if (chartStateMatch) {
      if (request.method === "PUT") {
        sendResult(response, handlePutChartState(db, chartStateMatch[1], await readJson(request)));
        return;
      }
      if (request.method === "DELETE") {
        sendResult(response, handleDeleteChartState(db, chartStateMatch[1]));
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/candles/sync") {
      const body = await readJson<SyncCandlesRequest>(request);
      sendResult(response, await handleSync(db, settings, body));
      return;
    }

    const candleMatch = url.pathname.match(/^\/api\/v1\/candles\/([^/]+)$/);
    if (request.method === "GET" && candleMatch) {
      sendResult(response, handleListCandles(db, candleMatch[1], url.searchParams));
      return;
    }

    const indicatorMatch = url.pathname.match(/^\/api\/v1\/indicators\/([^/]+)$/);
    if (request.method === "GET" && indicatorMatch) {
      sendResult(response, handleListIndicators(db, indicatorMatch[1], url.searchParams));
      return;
    }

    const optimizationResult = await routeOptimizationExperiments(
      db,
      experimentRunner,
      request,
      url,
    );
    if (optimizationResult) {
      sendResult(response, optimizationResult);
      return;
    }

    sendJson(response, 404, { detail: "Not found." });
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "Request body must be valid JSON."
        : error instanceof Error
          ? error.message
          : "Unexpected server error.";
    sendJson(response, statusCodeForError(error, message), { detail: message });
  }
});

server.listen(settings.port, "127.0.0.1", () => {
  console.log(`Geridon API listening on http://127.0.0.1:${settings.port}`);
});
