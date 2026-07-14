import { parseTimeframe } from "../timeframes.ts";
import type { BacktestPositionMode, OptimizationExperimentConfig } from "../types.ts";
import { parseEvolutionConfig } from "./optimizationEvolutionInputs.ts";
import { parseFolds, parseHoldout } from "./optimizationWindowInputs.ts";
import {
  parseParameterOverrides,
  parseRuleRoles,
  parseScoringConfig,
} from "./optimizationSearchInputs.ts";
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

const optionalObjectKeys = ["scoring", "halving", "refinement", "tpe", "evolution"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
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

  if (body.evolution != null && method !== "evolution") {
    return { error: "evolution settings require method to be evolution." };
  }
  const evolution = parseEvolutionConfig(body.evolution);
  if ("error" in evolution) {
    return { error: evolution.error };
  }

  const scoring = parseScoringConfig(body.scoring);
  if ("error" in scoring) {
    return { error: scoring.error };
  }

  const ruleRoles = parseRuleRoles(body.rule_roles);
  if ("error" in ruleRoles) {
    return { error: ruleRoles.error };
  }
  const parameterOverrides = parseParameterOverrides(body.parameter_overrides);
  if ("error" in parameterOverrides) {
    return { error: parameterOverrides.error };
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
    ...(scoring.scoring ? { scoring: scoring.scoring } : {}),
    ...(ruleRoles.roles ? { rule_roles: ruleRoles.roles } : {}),
    ...(parameterOverrides.overrides ? { parameter_overrides: parameterOverrides.overrides } : {}),
    ...(body.halving ? { halving: body.halving as OptimizationExperimentConfig["halving"] } : {}),
    ...(body.refinement
      ? { refinement: body.refinement as OptimizationExperimentConfig["refinement"] }
      : {}),
    ...(body.tpe ? { tpe: body.tpe as OptimizationExperimentConfig["tpe"] } : {}),
    ...(evolution.evolution ? { evolution: evolution.evolution } : {}),
  };
  return { config };
}

export { datasetSpecs, loadExperimentDatasets, priceAdjustmentNote } from "./optimizationDatasets.ts";
