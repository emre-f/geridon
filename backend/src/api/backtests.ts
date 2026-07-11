import type { Database } from "../db.ts";
import { runBacktest } from "../services/backtest.ts";
import { evaluateSignals } from "../services/signals.ts";
import { validateStrategy } from "../services/strategies.ts";
import { parseTimeframe } from "../timeframes.ts";
import type { BacktestPositionMode, Strategy } from "../types.ts";
import {
  backtestRunRecord,
  backtestRunSummary,
  snapshotMatchesDefinition,
} from "./backtestResponses.ts";
import {
  badRequest,
  candlesForTimeframe,
  parsePositiveId,
  parseTradeCosts,
  responseToCandle,
  validateTicker,
} from "./shared.ts";

export function handleSignals(db: Database, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Request body must be an object.");
  }

  const raw = body as Record<string, unknown>;
  if (typeof raw.ticker !== "string") {
    return badRequest("ticker is required.");
  }
  const ticker = raw.ticker.toUpperCase().trim();
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }
  if (typeof raw.timeframe !== "string") {
    return badRequest("timeframe is required.");
  }
  if (typeof raw.start_ms !== "number" || !Number.isFinite(raw.start_ms)) {
    return badRequest("start_ms is required.");
  }
  if (typeof raw.end_ms !== "number" || !Number.isFinite(raw.end_ms)) {
    return badRequest("end_ms is required.");
  }

  const { strategy, errors } = validateStrategy(raw.strategy);
  if (!strategy) {
    return { statusCode: 400, body: { valid: false, errors, strategy } };
  }

  const timeframe = parseTimeframe(raw.timeframe);
  const candles = candlesForTimeframe(db, {
    ticker,
    timeframe,
    startMs: raw.start_ms,
    endMs: raw.end_ms,
    limit: 50_000,
  }).map(responseToCandle);

  return { statusCode: 200, body: { signals: evaluateSignals(strategy, candles) } };
}

export function handleRunBacktest(db: Database, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Request body must be an object.");
  }

  const raw = body as Record<string, unknown>;
  const strategyId = Number(raw.strategy_id);
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    return badRequest("strategy_id must be a positive integer.");
  }
  const strategyRow = db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId);
  if (!strategyRow) {
    return { statusCode: 404, body: { detail: `Strategy ${strategyId} was not found.` } };
  }

  if (typeof raw.ticker !== "string") {
    return badRequest("ticker is required.");
  }
  const ticker = raw.ticker.toUpperCase().trim();
  const tickerError = validateTicker(ticker);
  if (tickerError) {
    return badRequest(tickerError);
  }
  if (typeof raw.timeframe !== "string") {
    return badRequest("timeframe is required.");
  }
  if (typeof raw.start_ms !== "number" || !Number.isFinite(raw.start_ms)) {
    return badRequest("start_ms is required.");
  }
  if (typeof raw.end_ms !== "number" || !Number.isFinite(raw.end_ms)) {
    return badRequest("end_ms is required.");
  }
  if (raw.end_ms <= raw.start_ms) {
    return badRequest("end_ms must be after start_ms.");
  }

  const positionMode = (raw.position_mode ?? "long_only") as BacktestPositionMode;
  if (
    positionMode !== "long_only" &&
    positionMode !== "always_in" &&
    positionMode !== "three_state"
  ) {
    return badRequest("position_mode must be long_only, always_in, or three_state.");
  }

  // always_in and three_state flip the whole account per fill, so partial sizing does not apply.
  const fullSize = positionMode !== "long_only";
  const buyPercent = fullSize ? 100 : raw.buy_percent == null ? 100 : Number(raw.buy_percent);
  const sellPercent = fullSize ? 100 : raw.sell_percent == null ? 100 : Number(raw.sell_percent);
  const initialCapital = raw.initial_capital == null ? 10_000 : Number(raw.initial_capital);
  if (!Number.isFinite(buyPercent) || buyPercent <= 0 || buyPercent > 100) {
    return badRequest("buy_percent must be greater than 0 and at most 100.");
  }
  if (!Number.isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return badRequest("sell_percent must be greater than 0 and at most 100.");
  }
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || initialCapital > 1e12) {
    return badRequest("initial_capital must be a positive number.");
  }
  const parsedCosts = parseTradeCosts(raw.costs);
  if ("error" in parsedCosts) {
    return badRequest(parsedCosts.error);
  }
  const costs = parsedCosts.costs;

  const strategy = JSON.parse(String(strategyRow.definition)) as Strategy;
  if (positionMode === "three_state" && strategy.cash == null) {
    return badRequest("three_state needs a strategy that defines a go-to-cash tree.");
  }
  const timeframe = parseTimeframe(raw.timeframe);
  const candles = candlesForTimeframe(db, {
    ticker,
    timeframe,
    startMs: raw.start_ms,
    endMs: raw.end_ms,
    limit: 50_000,
  }).map(responseToCandle);

  if (candles.length === 0) {
    return badRequest(`No stored ${timeframe.key} candles for ${ticker} in the requested range.`);
  }

  const result = runBacktest({
    strategy,
    candles,
    positionMode,
    buyPercent,
    sellPercent,
    initialCapital,
    costs,
  });

  const inserted = db
    .prepare(
      `
      INSERT INTO backtest_runs (
        strategy_id, ticker, timeframe, start_ms, end_ms,
        position_mode, buy_percent, sell_percent, initial_capital, costs,
        strategy_snapshot, metrics, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      strategyId,
      ticker,
      timeframe.key,
      raw.start_ms,
      raw.end_ms,
      positionMode,
      buyPercent,
      sellPercent,
      initialCapital,
      JSON.stringify(costs),
      JSON.stringify(strategy),
      JSON.stringify(result.metrics),
      JSON.stringify({ equity_curve: result.equity_curve, trades: result.trades }),
    );

  const row = db
    .prepare("SELECT * FROM backtest_runs WHERE id = ?")
    .get(Number(inserted.lastInsertRowid))!;
  // A fresh run always snapshots the current definition, so it is never outdated.
  return { statusCode: 201, body: backtestRunRecord(row, false) };
}

export function handleListStrategyBacktests(db: Database, idPath: string) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Strategy id must be a positive integer.");
  }
  const strategyRow = db.prepare("SELECT definition FROM strategies WHERE id = ?").get(id);
  if (!strategyRow) {
    return { statusCode: 404, body: { detail: `Strategy ${id} was not found.` } };
  }

  const definition = String(strategyRow.definition);
  const rows = db
    .prepare(
      `
      SELECT id, strategy_id, ticker, timeframe, start_ms, end_ms,
             position_mode, buy_percent, sell_percent, initial_capital, costs, metrics,
             strategy_snapshot, created_at
      FROM backtest_runs
      WHERE strategy_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(id);
  return {
    statusCode: 200,
    body: rows.map((row) =>
      backtestRunSummary(row, !snapshotMatchesDefinition(String(row.strategy_snapshot), definition)),
    ),
  };
}

export function handleGetBacktest(db: Database, idPath: string) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Backtest id must be a positive integer.");
  }

  const row = db.prepare("SELECT * FROM backtest_runs WHERE id = ?").get(id);
  if (!row) {
    return { statusCode: 404, body: { detail: `Backtest ${id} was not found.` } };
  }

  const strategyRow = db
    .prepare("SELECT definition FROM strategies WHERE id = ?")
    .get(Number(row.strategy_id));
  const outdated = strategyRow
    ? !snapshotMatchesDefinition(String(row.strategy_snapshot), String(strategyRow.definition))
    : true;
  return { statusCode: 200, body: backtestRunRecord(row, outdated) };
}

export function handleDeleteBacktest(db: Database, idPath: string) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Backtest id must be a positive integer.");
  }

  const changes = Number(db.prepare("DELETE FROM backtest_runs WHERE id = ?").run(id).changes);
  if (changes === 0) {
    return { statusCode: 404, body: { detail: `Backtest ${id} was not found.` } };
  }
  return { statusCode: 200, body: { id, deleted: true } };
}
