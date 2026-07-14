import { fitLogistic } from "./logisticRegression.ts";

/**
 * Platt scaling: fit sigmoid(a * margin + b) so the model's raw decision margins
 * become calibrated probabilities. Reuses the same logistic solver on a
 * single-feature (margin) design matrix.
 */
export interface Calibrator {
  a: number;
  b: number;
}

export function fitCalibrator(margins: number[], labels: number[]): Calibrator {
  if (margins.length === 0) {
    return { a: 1, b: 0 };
  }
  const model = fitLogistic(
    margins.map((margin) => [margin]),
    labels,
    { iterations: 300, l2: 0, learningRate: 0.3 },
  );
  return { a: model.weights[0], b: model.bias };
}

export function calibrateProbability(calibrator: Calibrator, margin: number): number {
  const z = calibrator.a * margin + calibrator.b;
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const exp = Math.exp(z);
  return exp / (1 + exp);
}

export type PolicySizing = "binary" | "linear";

export interface TradePolicyConfig {
  /** Take the trade when the calibrated probability is at least this. */
  threshold: number;
  /** binary: full or nothing; linear: scale size with probability above the threshold. */
  sizing: PolicySizing;
  /** Smallest fraction a taken trade may be shrunk to under linear sizing. */
  minSize: number;
}

export const defaultTradePolicy: TradePolicyConfig = {
  threshold: 0.5,
  sizing: "binary",
  minSize: 0.25,
};

export type PolicyDecision = "take" | "skip" | "shrink";

export interface PolicyAction {
  decision: PolicyDecision;
  /** Fraction of the baseline size to trade, always within [0, 1]. */
  size: number;
}

/**
 * Maps a calibrated probability to a trade action. The overlay can only remove
 * or shrink baseline trades, never enlarge them, so `size` never exceeds 1.
 */
export function applyPolicy(
  probability: number,
  config: TradePolicyConfig = defaultTradePolicy,
): PolicyAction {
  if (probability < config.threshold) {
    return { decision: "skip", size: 0 };
  }
  if (config.sizing === "binary") {
    return { decision: "take", size: 1 };
  }
  const span = 1 - config.threshold;
  const scaled =
    span <= 0 ? 1 : config.minSize + (1 - config.minSize) * ((probability - config.threshold) / span);
  const size = Math.min(1, Math.max(config.minSize, scaled));
  return { decision: size >= 1 ? "take" : "shrink", size };
}
