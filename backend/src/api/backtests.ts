import type { Database } from "../db.ts";
import { runBacktest } from "../services/backtest.ts";
import { evaluateSignals } from "../services/signals.ts";
import { validateStrategy } from "../services/strategies.ts";
import { parseTimeframe } from "../timeframes.ts";
import type {
  BacktestMetrics,
  BacktestPositionMode,
  BacktestResult,
  BacktestRunRecord,
  BacktestRunSummary,
  Strategy,
} from "../types.ts";
import {
  badRequest,
  candlesForTimeframe,
  parsePositiveId,
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

function backtestRunSummary(row: Record<string, unknown>): BacktestRunSummary {
  return {
    id: Number(row.id),
    strategy_id: Number(row.strategy_id),
    ticker: String(row.ticker),
    timeframe: String(row.timeframe),
    start_ms: Number(row.start_ms),
    end_ms: Number(row.end_ms),
    position_mode: (row.position_mode ?? "long_only") as BacktestPositionMode,
    buy_percent: Number(row.buy_percent),
    sell_percent: Number(row.sell_percent),
    initial_capital: Number(row.initial_capital),
    metrics: JSON.parse(String(row.metrics)) as BacktestMetrics,
    created_at: String(row.created_at),
  };
}

function backtestRunRecord(row: Record<string, unknown>): BacktestRunRecord {
  const detail = JSON.parse(String(row.detail)) as Pick<BacktestResult, "equity_curve" | "trades">;
  return {
    ...backtestRunSummary(row),
    strategy_snapshot: JSON.parse(String(row.strategy_snapshot)) as Strategy,
    equity_curve: detail.equity_curve,
    trades: detail.trades,
  };
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
  if (positionMode !== "long_only" && positionMode !== "always_in") {
    return badRequest("position_mode must be long_only or always_in.");
  }

  // Always-in mode is stop-and-reverse: every fill flips the whole account, so partial sizing does not apply.
  const buyPercent =
    positionMode === "always_in" ? 100 : raw.buy_percent == null ? 100 : Number(raw.buy_percent);
  const sellPercent =
    positionMode === "always_in" ? 100 : raw.sell_percent == null ? 100 : Number(raw.sell_percent);
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

  const strategy = JSON.parse(String(strategyRow.definition)) as Strategy;
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
  });

  const inserted = db
    .prepare(
      `
      INSERT INTO backtest_runs (
        strategy_id, ticker, timeframe, start_ms, end_ms,
        position_mode, buy_percent, sell_percent, initial_capital,
        strategy_snapshot, metrics, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(strategy),
      JSON.stringify(result.metrics),
      JSON.stringify({ equity_curve: result.equity_curve, trades: result.trades }),
    );

  const row = db
    .prepare("SELECT * FROM backtest_runs WHERE id = ?")
    .get(Number(inserted.lastInsertRowid))!;
  return { statusCode: 201, body: backtestRunRecord(row) };
}

export function handleListStrategyBacktests(db: Database, idPath: string) {
  const id = parsePositiveId(idPath);
  if (id == null) {
    return badRequest("Strategy id must be a positive integer.");
  }
  if (!db.prepare("SELECT 1 FROM strategies WHERE id = ?").get(id)) {
    return { statusCode: 404, body: { detail: `Strategy ${id} was not found.` } };
  }

  const rows = db
    .prepare(
      `
      SELECT id, strategy_id, ticker, timeframe, start_ms, end_ms,
             position_mode, buy_percent, sell_percent, initial_capital, metrics, created_at
      FROM backtest_runs
      WHERE strategy_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(id);
  return { statusCode: 200, body: rows.map(backtestRunSummary) };
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
  return { statusCode: 200, body: backtestRunRecord(row) };
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
