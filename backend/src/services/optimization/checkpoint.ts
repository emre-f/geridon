import type { CheckpointTrialFolds, FoldEvaluation } from "../../types.ts";

/**
 * Fold evaluations recovered from an interrupted run's streamed trial rows.
 * Candidates and folds are deterministic for a snapshot + seed, so a stored
 * evaluation for (candidate hash, symbol, fold) is byte-identical to what a
 * resumed run would recompute; reusing it only skips the backtest.
 */
export interface FoldCheckpoint {
  folds: Map<string, FoldEvaluation>;
  hits: number;
}

function checkpointKey(hash: string, symbol: string, foldIndex: number): string {
  return `${hash}:${symbol}:${foldIndex}`;
}

export function createFoldCheckpoint(
  trials?: CheckpointTrialFolds[],
): FoldCheckpoint | undefined {
  if (!trials || trials.length === 0) {
    return undefined;
  }
  const folds = new Map<string, FoldEvaluation>();
  for (const trial of trials) {
    for (const fold of trial.foldResults) {
      folds.set(checkpointKey(trial.hash, fold.symbol, fold.foldIndex), fold);
    }
  }
  return folds.size > 0 ? { folds, hits: 0 } : undefined;
}

export function takeCheckpointFold(
  checkpoint: FoldCheckpoint | undefined,
  hash: string,
  symbol: string,
  foldIndex: number,
): FoldEvaluation | undefined {
  const fold = checkpoint?.folds.get(checkpointKey(hash, symbol, foldIndex));
  if (fold && checkpoint) {
    checkpoint.hits += 1;
  }
  return fold;
}

export function hasCheckpointFolds(
  checkpoint: FoldCheckpoint | undefined,
  hash: string,
  foldsBySymbol: Map<string, { index: number }[]>,
): boolean {
  if (!checkpoint) {
    return false;
  }
  for (const [symbol, folds] of foldsBySymbol) {
    for (const fold of folds) {
      if (checkpoint.folds.has(checkpointKey(hash, symbol, fold.index))) {
        return true;
      }
    }
  }
  return false;
}
