import type { Database } from "../db.ts";
import { isInsertableGroup, resolveEvolutionConfig } from "../services/optimization/evolution.ts";
import { validateCaps } from "../services/optimization/evolutionGenome.ts";
import { buildFolds } from "../services/optimization/folds.ts";
import { searchDatasets, validateHoldoutSize } from "../services/optimization/holdout.ts";
import { compileSearchSpace } from "../services/optimization/searchSpace.ts";
import type {
  FoldSpec,
  OptimizationDataset,
  OptimizationExperimentConfig,
  SearchSpaceNode,
  Strategy,
} from "../types.ts";
import { loadExperimentDatasets } from "./optimizationDatasets.ts";
import { badRequest, type ApiResult } from "./shared.ts";

export interface ExperimentInputs {
  strategy: Strategy;
  strategyName: string;
  /** Full datasets including any sealed holdout candles. */
  datasets: OptimizationDataset[];
  /** The slices the optimizer is allowed to see. */
  searchData: OptimizationDataset[];
  foldsBySymbol: Map<string, FoldSpec[]>;
  nodes: SearchSpaceNode[];
}

/**
 * Loads and validates everything an experiment needs before it can run:
 * strategy, candles, holdout sizing, fold boundaries, and a non-empty search
 * space. Shared by experiment creation and the preflight estimate so both
 * accept and reject exactly the same configurations.
 */
export function prepareExperimentInputs(
  db: Database,
  config: OptimizationExperimentConfig,
): { inputs: ExperimentInputs } | { failure: ApiResult } {
  const strategyRow = db
    .prepare("SELECT name, definition FROM strategies WHERE id = ?")
    .get(config.strategy_id) as { name: string; definition: string } | undefined;
  if (!strategyRow) {
    return {
      failure: {
        statusCode: 404,
        body: { detail: `Strategy ${config.strategy_id} was not found.` },
      },
    };
  }
  const strategy = JSON.parse(String(strategyRow.definition)) as Strategy;
  if (config.position_mode === "three_state" && strategy.cash == null) {
    return { failure: badRequest("three_state needs a strategy that defines a go-to-cash tree.") };
  }
  if (config.method === "evolution" && config.evolution) {
    for (const point of config.evolution.insertionPoints ?? []) {
      if (!isInsertableGroup(strategy, point)) {
        return {
          failure: badRequest(
            `evolution.insertionPoints: "${point}" is not an enabled and/or group in the strategy.`,
          ),
        };
      }
    }
    const capError = validateCaps(strategy, resolveEvolutionConfig(config.evolution, strategy));
    if (capError) {
      return {
        failure: badRequest(`The baseline strategy already exceeds the evolution caps (${capError}).`),
      };
    }
  }

  try {
    const datasets = loadExperimentDatasets(db, config);
    if (config.holdout) {
      for (const dataset of datasets) {
        const holdoutError = validateHoldoutSize(
          dataset.symbol,
          dataset.candles.length,
          config.holdout,
        );
        if (holdoutError) {
          return { failure: badRequest(holdoutError) };
        }
      }
    }
    const searchData = searchDatasets(datasets, config.holdout);
    const foldsBySymbol = new Map<string, FoldSpec[]>();
    for (const dataset of searchData) {
      try {
        foldsBySymbol.set(dataset.symbol, buildFolds(dataset.candles.length, config.folds));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { failure: badRequest(`${dataset.symbol}: ${message}`) };
      }
    }

    const { nodes } = compileSearchSpace({
      strategy,
      ruleRoles: config.rule_roles,
      parameterOverrides: config.parameter_overrides,
    });
    const hasEvolutionLibrary =
      config.method === "evolution" && (config.evolution?.ruleLibrary?.length ?? 0) > 0;
    if (nodes.length === 0 && !hasEvolutionLibrary) {
      return {
        failure: badRequest(
          "The search space is empty: every parameter is locked and no rule is optional.",
        ),
      };
    }

    return {
      inputs: {
        strategy,
        strategyName: String(strategyRow.name),
        datasets,
        searchData,
        foldsBySymbol,
        nodes,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid experiment configuration.";
    return { failure: badRequest(message) };
  }
}
