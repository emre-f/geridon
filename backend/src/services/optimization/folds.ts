import type { FoldsConfig, FoldSpec } from "../../types.ts";

const defaultMinValidationCandles = 5;

export function buildFolds(candleCount: number, config: FoldsConfig): FoldSpec[] {
  const { foldCount, mode } = config;
  const minValidation = config.minValidationCandles ?? defaultMinValidationCandles;
  const embargo = config.embargoCandles ?? 0;
  if (!Number.isInteger(foldCount) || foldCount < 1) {
    throw new Error("foldCount must be a positive integer.");
  }
  if (!Number.isInteger(embargo) || embargo < 0) {
    throw new Error("embargoCandles must be a non-negative integer.");
  }

  const validationSize = Math.floor(candleCount / (foldCount + 1));
  if (validationSize - embargo < minValidation) {
    const embargoNote = embargo > 0 ? ` after the ${embargo}-candle embargo` : "";
    throw new Error(
      `Not enough candles for ${foldCount} folds: each validation window would have ` +
        `${Math.max(0, validationSize - embargo)} candles${embargoNote} (minimum ${minValidation}).`,
    );
  }

  const firstTrainSize = candleCount - foldCount * validationSize;
  const folds: FoldSpec[] = [];
  for (let index = 0; index < foldCount; index += 1) {
    const boundary = firstTrainSize + index * validationSize;
    const validEndIndex =
      index === foldCount - 1 ? candleCount - 1 : boundary + validationSize - 1;
    const trainStartIndex = mode === "rolling" ? boundary - firstTrainSize : 0;
    folds.push({
      index,
      trainStartIndex,
      trainEndIndex: boundary - 1,
      validStartIndex: boundary + embargo,
      validEndIndex,
    });
  }
  return folds;
}

/**
 * Picks a subset of folds spread across the whole timeline, so cheap
 * successive-halving stages see multiple market regimes instead of only the
 * earliest time prefix.
 */
export function spreadFoldSubset(folds: FoldSpec[], subsetSize: number): FoldSpec[] {
  if (subsetSize >= folds.length) {
    return folds;
  }
  const size = Math.max(1, subsetSize);
  const chosen = new Set<number>();
  for (let i = 0; i < size; i += 1) {
    const position = size === 1 ? folds.length - 1 : (i * (folds.length - 1)) / (size - 1);
    chosen.add(Math.round(position));
  }
  return folds.filter((fold) => chosen.has(fold.index));
}
