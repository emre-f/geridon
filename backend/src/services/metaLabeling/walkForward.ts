import { buildFolds } from "../optimization/folds.ts";
import { buildFeatureMatrix, featureSetId } from "./features.ts";
import { buildTradeEvents, type TradeEventRow } from "./tradeEvents.ts";
import {
  fitLogistic,
  fitStandardizer,
  logisticMargin,
  standardizeRow,
  type LogisticOptions,
} from "./logisticRegression.ts";
import { calibrateProbability, fitCalibrator } from "./tradePolicy.ts";
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
  /** Extra gap between a training event's exit and the validation window. Defaults to the median label horizon. */
  labelEmbargoCandles?: number;
  /** Chronological tail of each fold's training events reserved for probability calibration. */
  calibrationFraction?: number;
  logistic?: LogisticOptions;
}

export interface FoldPrediction {
  fold_index: number;
  event: TradeEventRow;
  /** Calibrated probability that the trade clears its costs. */
  probability: number;
  label: 0 | 1;
}

export interface WalkForwardResult {
  symbol: string;
  feature_set_id: string;
  fold_count: number;
  label_embargo_candles: number;
  /** Number of past events each fold's model was fit on. */
  training_sizes: number[];
  /** Folds whose training set had a single label class, so the overlay defaulted to taking every trade. */
  untrained_folds: number[];
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
  const untrainedFolds: number[] = [];
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

    const trainLabels = trainable.map((rowIndex) => dataset.rows[rowIndex].label);
    const distinctClasses = new Set(trainLabels);
    if (distinctClasses.size < 2) {
      untrainedFolds.push(fold.index);
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

  return {
    symbol: input.symbol,
    feature_set_id: featureSetId,
    fold_count: folds.length,
    label_embargo_candles: embargo,
    training_sizes: trainingSizes,
    untrained_folds: untrainedFolds,
    predictions,
  };
}
