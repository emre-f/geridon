import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fitLogistic,
  fitStandardizer,
  predictProbability,
  standardizeRow,
} from "../src/services/metaLabeling/logisticRegression.ts";
import {
  applyPolicy,
  calibrateProbability,
  defaultTradePolicy,
  fitCalibrator,
} from "../src/services/metaLabeling/tradePolicy.ts";
import { runWalkForward } from "../src/services/metaLabeling/walkForward.ts";
import { buildFolds } from "../src/services/optimization/folds.ts";
import { regimeDataset, thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function separableSample(count: number): { rows: number[][]; labels: number[] } {
  const random = lcg(7);
  const rows: number[][] = [];
  const labels: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const x0 = random() * 4 - 2;
    const x1 = random() * 4 - 2;
    const noise = random() * 0.4 - 0.2;
    rows.push([x0, x1]);
    labels.push(2 * x0 - 1.5 * x1 + noise > 0 ? 1 : 0);
  }
  return { rows, labels };
}

test("logistic regression learns a separable boundary and is deterministic", () => {
  const { rows, labels } = separableSample(300);
  const standardizer = fitStandardizer(rows);
  const matrix = rows.map((row) => standardizeRow(row, standardizer));
  const model = fitLogistic(matrix, labels, { iterations: 800 });

  let correct = 0;
  for (const [index, row] of matrix.entries()) {
    const predicted = predictProbability(model, row) >= 0.5 ? 1 : 0;
    if (predicted === labels[index]) {
      correct += 1;
    }
  }
  assert.ok(correct / labels.length > 0.9, "should separate a nearly linearly-separable set");

  assert.ok(model.weights[0] > 0, "x0 raises the odds");
  assert.ok(model.weights[1] < 0, "x1 lowers the odds");

  const again = fitLogistic(matrix, labels, { iterations: 800 });
  assert.deepEqual(again, model, "full-batch gradient descent from zero is deterministic");
});

test("standardizer mean-imputes nulls and normalizes columns", () => {
  const standardizer = fitStandardizer([
    [10, null],
    [20, 4],
    [null, 6],
  ]);
  assert.equal(standardizer.means[0], 15);
  assert.equal(standardizer.means[1], 5);

  const imputed = standardizeRow([null, null], standardizer);
  assert.deepEqual(imputed, [0, 0], "a null becomes the column mean, i.e. zero after standardizing");
});

test("calibration produces monotonic probabilities and the policy only shrinks or skips", () => {
  const margins = [-3, -2, -1, -0.2, 0.2, 1, 2, 3];
  const labels = [0, 0, 0, 0, 1, 1, 1, 1];
  const calibrator = fitCalibrator(margins, labels);

  const probabilities = margins.map((margin) => calibrateProbability(calibrator, margin));
  for (let index = 1; index < probabilities.length; index += 1) {
    assert.ok(
      probabilities[index] >= probabilities[index - 1],
      "a larger margin never lowers the calibrated probability",
    );
  }
  assert.ok(probabilities[0] < 0.5 && probabilities.at(-1)! > 0.5);

  assert.deepEqual(applyPolicy(0.9), { decision: "take", size: 1 });
  assert.deepEqual(applyPolicy(0.1), { decision: "skip", size: 0 });

  const linear = applyPolicy(0.75, { threshold: 0.5, sizing: "linear", minSize: 0.25 });
  assert.equal(linear.decision, "shrink");
  assert.ok(linear.size > 0 && linear.size < 1, "linear sizing shrinks a marginal trade");
  for (const probability of [0, 0.3, 0.5, 0.7, 1]) {
    const size = applyPolicy(probability, { threshold: 0.4, sizing: "linear", minSize: 0.2 }).size;
    assert.ok(size >= 0 && size <= 1, "the overlay never enlarges a trade");
  }
});

const walkForwardBase = {
  symbol: "TEST" as const,
  positionMode: "long_only" as const,
  buyPercent: 100,
  sellPercent: 100,
  initialCapital: 10_000,
  folds: { foldCount: 4, mode: "anchored" as const },
};

test("walk-forward trains per fold on resolved past trades and stays causal", () => {
  const candles = regimeDataset().candles;
  const input = {
    ...walkForwardBase,
    strategy: thresholdStrategy(100, 101.9),
    candles,
    costs: { commission_per_trade: 0, commission_pct: 2, slippage_bps: 0 },
  };
  const result = runWalkForward(input);
  const folds = buildFolds(candles.length, input.folds);

  assert.equal(result.fold_count, 4);
  assert.equal(result.untrained_folds.length, 0, "both label classes exist, so every fold trains");
  assert.ok(result.label_embargo_candles > 0, "the embargo defaults to the median label horizon");

  for (let index = 1; index < result.training_sizes.length; index += 1) {
    assert.ok(
      result.training_sizes[index] >= result.training_sizes[index - 1],
      "anchored folds see a growing training history",
    );
  }

  for (const prediction of result.predictions) {
    const fold = folds[prediction.fold_index];
    assert.ok(
      prediction.event.trigger_index >= fold.validStartIndex &&
        prediction.event.trigger_index <= fold.validEndIndex,
      "a scored trade is triggered inside its fold's validation window",
    );
    assert.ok(prediction.probability >= 0 && prediction.probability <= 1);
  }

  assert.deepEqual(runWalkForward(input), result, "the loop is reproducible");
});

test("a larger label embargo can only remove training trades near the boundary", () => {
  const candles = regimeDataset().candles;
  const base = {
    ...walkForwardBase,
    strategy: thresholdStrategy(100, 101.9),
    candles,
    costs: { commission_per_trade: 0, commission_pct: 2, slippage_bps: 0 },
  };
  const tight = runWalkForward({ ...base, labelEmbargoCandles: 0 });
  const wide = runWalkForward({ ...base, labelEmbargoCandles: 40 });
  for (let index = 0; index < tight.training_sizes.length; index += 1) {
    assert.ok(
      wide.training_sizes[index] <= tight.training_sizes[index],
      "embargoing the boundary never adds training trades",
    );
  }
});

test("a single-class training set defaults the overlay to taking every trade", () => {
  const result = runWalkForward({
    ...walkForwardBase,
    strategy: thresholdStrategy(95, 105),
    candles: triangleCandles(400),
  });
  assert.deepEqual(result.untrained_folds, [0, 1, 2, 3], "frictionless triangle trades all win");
  assert.ok(
    result.predictions.length > 0 && result.predictions.every((prediction) => prediction.probability === 1),
    "with nothing to learn the overlay must not shrink the baseline",
  );
  assert.ok(
    result.predictions.every((prediction) => applyPolicy(prediction.probability).decision === "take"),
  );
  assert.equal(defaultTradePolicy.threshold, 0.5);
});
