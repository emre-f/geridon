import type {
  CheckpointTrialFolds,
  OptimizationConfig,
  OptimizationDataset,
  OptimizationExperimentRecord,
} from "../../types.ts";
import { searchDatasets } from "./holdout.ts";

export function toEngineConfig(
  record: OptimizationExperimentRecord,
  datasets: OptimizationDataset[],
  checkpoint?: CheckpointTrialFolds[],
): OptimizationConfig {
  const config = record.config;
  return {
    strategy: record.snapshot.strategy,
    // The sealed holdout candles must never reach the optimizer.
    datasets: searchDatasets(datasets, config.holdout),
    positionMode: config.position_mode,
    buyPercent: config.buy_percent,
    sellPercent: config.sell_percent,
    initialCapital: config.initial_capital,
    costs: config.costs,
    seed: config.seed,
    maxTrials: config.max_trials,
    maxRuntimeMs: config.max_runtime_ms,
    folds: config.folds,
    scoring: config.scoring,
    ruleRoles: config.rule_roles,
    parameterOverrides: config.parameter_overrides,
    halving: config.halving,
    refinement: config.refinement,
    method: config.method,
    tpe: config.tpe,
    evolution: config.evolution,
    ...(checkpoint && checkpoint.length > 0 ? { checkpoint } : {}),
  };
}
