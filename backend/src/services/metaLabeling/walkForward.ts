import { buildFolds } from "../optimization/folds.ts";
import { buildFeatureMatrix, featureSetId } from "./features.ts";
import { buildTradeEvents, type TradeEventRow } from "./tradeEvents.ts";
import {
  fitLogistic,
  fitStandardizer,
  logisticMargin,
  standardizeRow,
  type LogisticModel,
  type LogisticOptions,
  type Standardizer,
} from "./logisticRegression.ts";
import { calibrateProbability, fitCalibrator, type Calibrator } from "./tradePolicy.ts";
import type {
  BacktestPositionMode,
  Candle,
  FoldsConfig,
  Strategy,
  TradeCosts,
} from "../../types.ts";

export interface WalkForwardInput {
  symbol: string;
  strategy: Strategy;
  candles: Candle[];
  positionMode: BacktestPositionMode;
  buyPercent: number;
  sellPercent: number;
  initialCapital: number;
  costs?: TradeCosts;
  simulationStartIndex?: number;
  folds: FoldsConfig;
  labelEmbargoCandles?: number;
  calibrationFraction?: number;
  logistic?: LogisticOptions;
}

export interface FoldPrediction {
  fold_index: number;
  event: TradeEventRow;
  probability: number;
  label: 0 | 1;
}

export interface FoldModel {
  fold_index: number;
  trained: boolean;
  standardizer: Standardizer | null;
  model: LogisticModel | null;
  calibrator: Calibrator | null;
}

export interface WalkForwardResult {
  symbol: string;
  feature_set_id: string;
  fold_count: number;
  label_embargo_candles: number;
  training_sizes: number[];
  validation_sizes: number[];
  untrained_folds: number[];
  total_events: number;
  positive_events: number;
  negative_events: number;
  open_trades: number;
  fold_models: FoldModel[];
  predictions: FoldPrediction[];
}

function medianHorizon(events: TradeEventRow[]): number {
  if (events.length === 0) {
    return 0;
  }
  const sorted = events.map((event) => event.horizon_candles).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const defaultCalibrationFraction = 0.25;

export function runWalkForward(input: WalkForwardInput): WalkForwardResult {
  const dataset = buildTradeEvents(input);
  const matrix = buildFeatureMatrix(input.candles, dataset.rows);
  const folds = buildFolds(input.candles.length, input.folds);
  const embargo = input.labelEmbargoCandles ?? medianHorizon(dataset.rows);
  const calibrationFraction = input.calibrationFraction ?? defaultCalibrationFraction;

  const trainingSizes: number[] = [];
  const validationSizes: number[] = [];
  const untrainedFolds: number[] = [];
  const foldModels: FoldModel[] = [];
  const predictions: FoldPrediction[] = [];

  for (const fold of folds) {
    const trainable: number[] = [];
    const validation: number[] = [];
    for (const [rowIndex, event] of dataset.rows.entries()) {
      if (event.exit_index < fold.validStartIndex - embargo) {
        trainable.push(rowIndex);
      } else if (
        event.trigger_index >= fold.validStartIndex &&
        event.trigger_index <= fold.validEndIndex
      ) {
        validation.push(rowIndex);
      }
    }
    trainingSizes.push(trainable.length);
    validationSizes.push(validation.length);

    const trainLabels = trainable.map((rowIndex) => dataset.rows[rowIndex].label);
    const distinctClasses = new Set(trainLabels);
    if (distinctClasses.size < 2) {
      untrainedFolds.push(fold.index);
      foldModels.push({
        fold_index: fold.index,
        trained: false,
        standardizer: null,
        model: null,
        calibrator: null,
      });
      for (const rowIndex of validation) {
        predictions.push({
          fold_index: fold.index,
          event: dataset.rows[rowIndex],
          probability: 1,
          label: dataset.rows[rowIndex].label,
        });
      }
      continue;
    }

    const calibrationStart = Math.floor(trainable.length * (1 - calibrationFraction));
    const fitIndices = trainable.slice(0, Math.max(1, calibrationStart));
    const calibrationIndices = trainable.slice(fitIndices.length);

    const standardizer = fitStandardizer(fitIndices.map((rowIndex) => matrix.rows[rowIndex]));
    const fitMatrix = fitIndices.map((rowIndex) =>
      standardizeRow(matrix.rows[rowIndex], standardizer),
    );
    const model = fitLogistic(
      fitMatrix,
      fitIndices.map((rowIndex) => dataset.rows[rowIndex].label),
      input.logistic,
    );

    const calibrationRows = calibrationIndices.length >= 2 ? calibrationIndices : fitIndices;
    const calibrationLabels = calibrationRows.map((rowIndex) => dataset.rows[rowIndex].label);
    const calibrator =
      new Set(calibrationLabels).size < 2
        ? { a: 1, b: 0 }
        : fitCalibrator(
            calibrationRows.map((rowIndex) =>
              logisticMargin(model, standardizeRow(matrix.rows[rowIndex], standardizer)),
            ),
            calibrationLabels,
          );

    foldModels.push({
      fold_index: fold.index,
      trained: true,
      standardizer,
      model,
      calibrator,
    });

    for (const rowIndex of validation) {
      const margin = logisticMargin(
        model,
        standardizeRow(matrix.rows[rowIndex], standardizer),
      );
      predictions.push({
        fold_index: fold.index,
        event: dataset.rows[rowIndex],
        probability: calibrateProbability(calibrator, margin),
        label: dataset.rows[rowIndex].label,
      });
    }
  }

  const positiveEvents = dataset.rows.reduce((sum, row) => sum + row.label, 0);

  return {
    symbol: input.symbol,
    feature_set_id: featureSetId,
    fold_count: folds.length,
    label_embargo_candles: embargo,
    training_sizes: trainingSizes,
    validation_sizes: validationSizes,
    untrained_folds: untrainedFolds,
    total_events: dataset.rows.length,
    positive_events: positiveEvents,
    negative_events: dataset.rows.length - positiveEvents,
    open_trades: dataset.open_trades,
    fold_models: foldModels,
    predictions,
  };
}
