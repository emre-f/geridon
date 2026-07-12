import { parseTimeframe } from "../timeframes.ts";
import { holdoutLimits } from "../services/optimization/holdout.ts";
import type {
  BacktestPositionMode,
  FoldsConfig,
  HoldoutConfig,
  OptimizationExperimentConfig,
} from "../types.ts";
import { parseTradeCosts, validateTicker } from "./shared.ts";

export const experimentLimits = {
  maxTickers: 4,
  maxTrials: 500,
  minRuntimeMs: 1_000,
  maxRuntimeMs: 30 * 60_000,
  minFolds: 2,
  maxFolds: 12,
  maxEmbargoCandles: 250,
};

const optionalObjectKeys = [
  "scoring",
  "rule_roles",
  "parameter_overrides",
  "halving",
  "refinement",
  "tpe",
  "evolution",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseFolds(raw: unknown): FoldsConfig | string {
  if (raw == null) {
    return { foldCount: 4, mode: "anchored" };
  }
  if (!isPlainObject(raw)) {
    return "folds must be an object.";
  }
  const foldCount = Number(raw.foldCount);
  if (
    !Number.isInteger(foldCount) ||
    foldCount < experimentLimits.minFolds ||
    foldCount > experimentLimits.maxFolds
  ) {
    return `folds.foldCount must be an integer between ${experimentLimits.minFolds} and ${experimentLimits.maxFolds}.`;
  }
  const mode = raw.mode ?? "anchored";
  if (mode !== "anchored" && mode !== "rolling") {
    return "folds.mode must be anchored or rolling.";
  }
  const folds: FoldsConfig = { foldCount, mode };
  if (raw.minValidationCandles != null) {
    const minValidation = Number(raw.minValidationCandles);
    if (!Number.isInteger(minValidation) || minValidation < 2) {
      return "folds.minValidationCandles must be an integer of at least 2.";
    }
    folds.minValidationCandles = minValidation;
  }
  if (raw.embargoCandles != null) {
    const embargo = Number(raw.embargoCandles);
    if (!Number.isInteger(embargo) || embargo < 0 || embargo > experimentLimits.maxEmbargoCandles) {
      return `folds.embargoCandles must be an integer between 0 and ${experimentLimits.maxEmbargoCandles}.`;
    }
    folds.embargoCandles = embargo;
  }
  return folds;
}

function parseHoldout(raw: unknown): HoldoutConfig | null | string {
  if (raw == null) {
    return null;
  }
  if (!isPlainObject(raw)) {
    return "holdout must be an object.";
  }
  const fraction = Number(raw.fraction);
  if (
    !Number.isFinite(fraction) ||
    fraction < holdoutLimits.minFraction ||
    fraction > holdoutLimits.maxFraction
  ) {
    return `holdout.fraction must be between ${holdoutLimits.minFraction} and ${holdoutLimits.maxFraction}.`;
  }
  return { fraction };
}

export function parseExperimentRequest(
  body: unknown,
): { config: OptimizationExperimentConfig } | { error: string } {
  if (!isPlainObject(body)) {
    return { error: "Request body must be an object." };
  }

  const strategyId = Number(body.strategy_id);
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    return { error: "strategy_id must be a positive integer." };
  }

  if (!Array.isArray(body.tickers) || body.tickers.length === 0) {
    return { error: "tickers must be a non-empty array." };
  }
  if (body.tickers.length > experimentLimits.maxTickers) {
    return { error: `tickers must contain at most ${experimentLimits.maxTickers} symbols.` };
  }
  const tickers: string[] = [];
  for (const rawTicker of body.tickers) {
    if (typeof rawTicker !== "string") {
      return { error: "tickers must contain strings." };
    }
    const ticker = rawTicker.toUpperCase().trim();
    const tickerError = validateTicker(ticker);
    if (tickerError) {
      return { error: tickerError };
    }
    if (tickers.includes(ticker)) {
      return { error: `tickers contains ${ticker} more than once.` };
    }
    tickers.push(ticker);
  }

  if (typeof body.timeframe !== "string") {
    return { error: "timeframe is required." };
  }
  const timeframe = parseTimeframe(body.timeframe);

  if (typeof body.start_ms !== "number" || !Number.isFinite(body.start_ms)) {
    return { error: "start_ms is required." };
  }
  if (typeof body.end_ms !== "number" || !Number.isFinite(body.end_ms)) {
    return { error: "end_ms is required." };
  }
  if (body.end_ms <= body.start_ms) {
    return { error: "end_ms must be after start_ms." };
  }

  const positionMode = (body.position_mode ?? "long_only") as BacktestPositionMode;
  if (
    positionMode !== "long_only" &&
    positionMode !== "always_in" &&
    positionMode !== "three_state"
  ) {
    return { error: "position_mode must be long_only, always_in, or three_state." };
  }
  const fullSize = positionMode !== "long_only";
  const buyPercent = fullSize ? 100 : body.buy_percent == null ? 100 : Number(body.buy_percent);
  const sellPercent = fullSize ? 100 : body.sell_percent == null ? 100 : Number(body.sell_percent);
  const initialCapital = body.initial_capital == null ? 10_000 : Number(body.initial_capital);
  if (!Number.isFinite(buyPercent) || buyPercent <= 0 || buyPercent > 100) {
    return { error: "buy_percent must be greater than 0 and at most 100." };
  }
  if (!Number.isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return { error: "sell_percent must be greater than 0 and at most 100." };
  }
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || initialCapital > 1e12) {
    return { error: "initial_capital must be a positive number." };
  }
  const parsedCosts = parseTradeCosts(body.costs);
  if ("error" in parsedCosts) {
    return { error: parsedCosts.error };
  }

  const seed = body.seed == null ? 1 : Number(body.seed);
  if (!Number.isInteger(seed)) {
    return { error: "seed must be an integer." };
  }
  const maxTrials = body.max_trials == null ? 50 : Number(body.max_trials);
  if (!Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > experimentLimits.maxTrials) {
    return { error: `max_trials must be an integer between 1 and ${experimentLimits.maxTrials}.` };
  }
  const maxRuntimeMs = body.max_runtime_ms == null ? 120_000 : Number(body.max_runtime_ms);
  if (
    !Number.isFinite(maxRuntimeMs) ||
    maxRuntimeMs < experimentLimits.minRuntimeMs ||
    maxRuntimeMs > experimentLimits.maxRuntimeMs
  ) {
    return {
      error: `max_runtime_ms must be between ${experimentLimits.minRuntimeMs} and ${experimentLimits.maxRuntimeMs}.`,
    };
  }

  const method = body.method ?? "random";
  if (method !== "random" && method !== "tpe" && method !== "evolution") {
    return { error: "method must be random, tpe, or evolution." };
  }

  const folds = parseFolds(body.folds);
  if (typeof folds === "string") {
    return { error: folds };
  }

  const holdout = parseHoldout(body.holdout);
  if (typeof holdout === "string") {
    return { error: holdout };
  }

  for (const key of optionalObjectKeys) {
    if (body[key] != null && !isPlainObject(body[key])) {
      return { error: `${key} must be an object.` };
    }
  }

  const config: OptimizationExperimentConfig = {
    strategy_id: strategyId,
    tickers,
    timeframe: timeframe.key,
    start_ms: body.start_ms,
    end_ms: body.end_ms,
    position_mode: positionMode,
    buy_percent: buyPercent,
    sell_percent: sellPercent,
    initial_capital: initialCapital,
    costs: parsedCosts.costs,
    seed,
    max_trials: maxTrials,
    max_runtime_ms: maxRuntimeMs,
    method,
    folds,
    ...(holdout ? { holdout } : {}),
    ...(body.scoring ? { scoring: body.scoring as OptimizationExperimentConfig["scoring"] } : {}),
    ...(body.rule_roles
      ? { rule_roles: body.rule_roles as OptimizationExperimentConfig["rule_roles"] }
      : {}),
    ...(body.parameter_overrides
      ? {
          parameter_overrides:
            body.parameter_overrides as OptimizationExperimentConfig["parameter_overrides"],
        }
      : {}),
    ...(body.halving ? { halving: body.halving as OptimizationExperimentConfig["halving"] } : {}),
    ...(body.refinement
      ? { refinement: body.refinement as OptimizationExperimentConfig["refinement"] }
      : {}),
    ...(body.tpe ? { tpe: body.tpe as OptimizationExperimentConfig["tpe"] } : {}),
    ...(body.evolution
      ? { evolution: body.evolution as OptimizationExperimentConfig["evolution"] }
      : {}),
  };
  return { config };
}

export { datasetSpecs, loadExperimentDatasets } from "./optimizationDatasets.ts";
