import { buildFolds } from "../optimization/folds.ts";
import { buildFeatureMatrix } from "./features.ts";
import { buildTradeEvents } from "./tradeEvents.ts";
import {
  logisticMargin,
  standardizeRow,
  type LogisticOptions,
} from "./logisticRegression.ts";
import { calibrateProbability, type TradePolicyConfig } from "./tradePolicy.ts";
import type {
  FoldModel,
  FoldPrediction,
  WalkForwardInput,
  WalkForwardResult,
} from "./walkForward.ts";
import type { TradeCosts } from "../../types.ts";

export const overlayArtifactVersion = "meta-overlay-v1";

const defaultLogistic: Required<LogisticOptions> = {
  learningRate: 0.1,
  iterations: 500,
  l2: 0.01,
};
const defaultCalibrationFraction = 0.25;
const defaultSeed = 1;

export interface OverlayLabelDefinition {
  rule: "net_pnl_positive";
  costs: TradeCosts | null;
  horizon: "per_trade_round_trip";
}

export interface OverlayArtifact {
  artifact_version: string;
  feature_set_id: string;
  label: OverlayLabelDefinition;
  seed: number;
  policy: TradePolicyConfig;
  label_embargo_candles: number;
  calibration_fraction: number;
  logistic: Required<LogisticOptions>;
  fold_models: FoldModel[];
}

export interface BuildArtifactOptions {
  policy: TradePolicyConfig;
  seed?: number;
}

export function buildOverlayArtifact(
  input: WalkForwardInput,
  walkForward: WalkForwardResult,
  options: BuildArtifactOptions,
): OverlayArtifact {
  return {
    artifact_version: overlayArtifactVersion,
    feature_set_id: walkForward.feature_set_id,
    label: {
      rule: "net_pnl_positive",
      costs: input.costs ?? null,
      horizon: "per_trade_round_trip",
    },
    seed: options.seed ?? defaultSeed,
    policy: options.policy,
    label_embargo_candles: walkForward.label_embargo_candles,
    calibration_fraction: input.calibrationFraction ?? defaultCalibrationFraction,
    logistic: {
      learningRate: input.logistic?.learningRate ?? defaultLogistic.learningRate,
      iterations: input.logistic?.iterations ?? defaultLogistic.iterations,
      l2: input.logistic?.l2 ?? defaultLogistic.l2,
    },
    fold_models: walkForward.fold_models,
  };
}

function foldProbability(model: FoldModel | undefined, row: Array<number | null>): number {
  if (!model || !model.trained || !model.model || !model.standardizer || !model.calibrator) {
    return 1;
  }
  const margin = logisticMargin(model.model, standardizeRow(row, model.standardizer));
  return calibrateProbability(model.calibrator, margin);
}

export function predictFromArtifact(
  artifact: OverlayArtifact,
  input: WalkForwardInput,
): FoldPrediction[] {
  const dataset = buildTradeEvents(input);
  const matrix = buildFeatureMatrix(input.candles, dataset.rows);
  const folds = buildFolds(input.candles.length, input.folds);
  const modelByFold = new Map(artifact.fold_models.map((model) => [model.fold_index, model]));

  const predictions: FoldPrediction[] = [];
  for (const fold of folds) {
    const model = modelByFold.get(fold.index);
    for (const [rowIndex, event] of dataset.rows.entries()) {
      if (event.trigger_index < fold.validStartIndex || event.trigger_index > fold.validEndIndex) {
        continue;
      }
      predictions.push({
        fold_index: fold.index,
        event,
        probability: foldProbability(model, matrix.rows[rowIndex]),
        label: event.label,
      });
    }
  }
  return predictions;
}
