import { holdoutLimits } from "../services/optimization/holdout.ts";
import type { FoldsConfig, HoldoutConfig } from "../types.ts";
import { experimentLimits } from "./optimizationRequests.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseFolds(raw: unknown): FoldsConfig | string {
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

export function parseHoldout(raw: unknown): HoldoutConfig | null | string {
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
