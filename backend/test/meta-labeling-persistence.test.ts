import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateOverlay } from "../src/services/metaLabeling/evaluation.ts";
import {
  buildOverlayArtifact,
  overlayArtifactVersion,
  predictFromArtifact,
} from "../src/services/metaLabeling/overlayArtifact.ts";
import { runWalkForward } from "../src/services/metaLabeling/walkForward.ts";
import { defaultTradePolicy } from "../src/services/metaLabeling/tradePolicy.ts";
import { regimeDataset, thresholdStrategy } from "./optimizationFixtures.ts";

const walkForwardBase = {
  symbol: "TEST" as const,
  positionMode: "long_only" as const,
  buyPercent: 100,
  sellPercent: 100,
  initialCapital: 10_000,
  folds: { foldCount: 4, mode: "anchored" as const },
};

function overlayInput() {
  return {
    ...walkForwardBase,
    strategy: thresholdStrategy(100, 101.9),
    candles: regimeDataset().candles,
    costs: { commission_per_trade: 0, commission_pct: 2, slippage_bps: 0 },
  };
}

test("the overlay artifact captures every reproducibility input", () => {
  const input = overlayInput();
  const wf = runWalkForward(input);
  const artifact = buildOverlayArtifact(input, wf, { policy: defaultTradePolicy, seed: 7 });

  assert.equal(artifact.artifact_version, overlayArtifactVersion);
  assert.equal(artifact.feature_set_id, wf.feature_set_id);
  assert.equal(artifact.seed, 7);
  assert.deepEqual(artifact.policy, defaultTradePolicy);
  assert.equal(artifact.label_embargo_candles, wf.label_embargo_candles);
  assert.deepEqual(artifact.label, {
    rule: "net_pnl_positive",
    costs: input.costs,
    horizon: "per_trade_round_trip",
  });
  assert.deepEqual(artifact.logistic, { learningRate: 0.1, iterations: 500, l2: 0.01 });
  assert.equal(artifact.calibration_fraction, 0.25);

  assert.equal(artifact.fold_models.length, wf.fold_count);
  assert.ok(
    artifact.fold_models.some((model) => model.trained),
    "at least one fold trains a model, so coefficients are actually stored",
  );
  for (const model of artifact.fold_models) {
    if (model.trained) {
      assert.ok(model.model && model.standardizer && model.calibrator);
      assert.equal(model.model.weights.length, 6, "one weight per meta feature");
    } else {
      assert.equal(model.model, null);
    }
  }
});

test("a stored artifact replays predictions byte-identically without retraining", () => {
  const input = overlayInput();
  const wf = runWalkForward(input);
  const artifact = buildOverlayArtifact(input, wf, { policy: defaultTradePolicy });

  const replayed = predictFromArtifact(artifact, input);
  assert.deepEqual(replayed, wf.predictions, "replay from frozen coefficients equals the training run");
});

test("the artifact survives JSON serialization and still reproduces exactly", () => {
  const input = overlayInput();
  const wf = runWalkForward(input);
  const artifact = buildOverlayArtifact(input, wf, { policy: defaultTradePolicy });

  const roundTripped = JSON.parse(JSON.stringify(artifact));
  assert.deepEqual(roundTripped, artifact, "the artifact is plain, serializable data");

  const replayed = predictFromArtifact(roundTripped, input);
  assert.deepEqual(replayed, wf.predictions, "a persisted-then-reloaded overlay predicts identically");
});

test("evaluateOverlay attaches a reproducible artifact", () => {
  const input = overlayInput();
  const evaluation = evaluateOverlay(input, { seed: 3 });

  assert.equal(evaluation.artifact.artifact_version, overlayArtifactVersion);
  assert.equal(evaluation.artifact.seed, 3);
  assert.deepEqual(evaluation.artifact.fold_models, evaluation.walk_forward.fold_models);

  const replayed = predictFromArtifact(evaluation.artifact, input);
  assert.deepEqual(replayed, evaluation.walk_forward.predictions);
});
