import { buildFolds } from "../optimization/folds.ts";
import { resolveScoringConfig, scoreTrial } from "../optimization/scoring.ts";
import { computeComplexity } from "../optimization/strategyPaths.ts";
import {
  classify,
  foldEvaluationFromTrades,
  precision,
  recall,
  type AppliedTrade,
} from "./overlayMetrics.ts";
import { evaluateGuardrails, type GuardrailReport } from "./guardrails.ts";
import { buildOverlayArtifact, type OverlayArtifact } from "./overlayArtifact.ts";
import { applyPolicy, defaultTradePolicy, type TradePolicyConfig } from "./tradePolicy.ts";
import { runWalkForward, type FoldPrediction, type WalkForwardInput, type WalkForwardResult } from "./walkForward.ts";
import type { FoldEvaluation, ScoringConfig, TrialScore } from "../../types.ts";

export type PolicyName = "filtered" | "take_everything" | "random_skip";

export interface PolicyFoldStats {
  fold_index: number;
  trades_total: number;
  trades_kept: number;
  trades_skipped: number;
  trades_shrunk: number;
  precision: number | null;
  recall: number | null;
}

export interface PolicyEvaluation {
  policy: PolicyName;
  score: TrialScore;
  fold_evaluations: FoldEvaluation[];
  fold_stats: PolicyFoldStats[];
  trades_total: number;
  trades_kept: number;
  trades_skipped: number;
  trades_shrunk: number;
  skip_rate: number;
  precision: number | null;
  recall: number | null;
}

export interface OverlayEvaluation {
  symbol: string;
  feature_set_id: string;
  seed: number;
  policy: TradePolicyConfig;
  guardrails: GuardrailReport;
  take_everything: PolicyEvaluation;
  filtered: PolicyEvaluation;
  random_skip: PolicyEvaluation;
  walk_forward: WalkForwardResult;
  artifact: OverlayArtifact;
}

export interface OverlayEvaluationOptions {
  policy?: TradePolicyConfig;
  seed?: number;
  scoring?: Partial<ScoringConfig>;
  walkForward?: WalkForwardResult;
}

function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seededPick(length: number, count: number, random: () => number): Set<number> {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Set(order.slice(0, Math.min(count, length)));
}

function foldPredictions(wf: WalkForwardResult): Map<number, FoldPrediction[]> {
  const byFold = new Map<number, FoldPrediction[]>();
  for (const prediction of wf.predictions) {
    const bucket = byFold.get(prediction.fold_index) ?? [];
    bucket.push(prediction);
    byFold.set(prediction.fold_index, bucket);
  }
  return byFold;
}

function buildPolicyEvaluation(
  policy: PolicyName,
  symbol: string,
  byFold: Map<number, FoldPrediction[]>,
  sizeFor: (fold: number, indexInFold: number, prediction: FoldPrediction) => number,
  candleCounts: Map<number, number>,
  scoring: ScoringConfig,
  complexity: ReturnType<typeof computeComplexity>,
): PolicyEvaluation {
  const foldEvaluations: FoldEvaluation[] = [];
  const foldStats: PolicyFoldStats[] = [];
  let total = 0;
  let kept = 0;
  let shrunk = 0;
  const overall = { taken_winners: 0, taken_losers: 0, skipped_winners: 0, skipped_losers: 0 };

  for (const fold of [...byFold.keys()].sort((a, b) => a - b)) {
    const predictions = byFold.get(fold) ?? [];
    const applied: AppliedTrade[] = predictions.map((prediction, indexInFold) => ({
      size: sizeFor(fold, indexInFold, prediction),
      return_pct: prediction.event.return_pct,
      label: prediction.label,
    }));

    const counts = classify(applied);
    overall.taken_winners += counts.taken_winners;
    overall.taken_losers += counts.taken_losers;
    overall.skipped_winners += counts.skipped_winners;
    overall.skipped_losers += counts.skipped_losers;

    const foldKept = applied.filter((trade) => trade.size > 0).length;
    const foldShrunk = applied.filter((trade) => trade.size > 0 && trade.size < 1).length;
    total += applied.length;
    kept += foldKept;
    shrunk += foldShrunk;

    foldEvaluations.push(
      foldEvaluationFromTrades(symbol, fold, applied, candleCounts.get(fold) ?? 0, scoring.objective),
    );
    foldStats.push({
      fold_index: fold,
      trades_total: applied.length,
      trades_kept: foldKept,
      trades_skipped: applied.length - foldKept,
      trades_shrunk: foldShrunk,
      precision: precision(counts),
      recall: recall(counts),
    });
  }

  return {
    policy,
    score: scoreTrial(foldEvaluations, complexity, scoring),
    fold_evaluations: foldEvaluations,
    fold_stats: foldStats,
    trades_total: total,
    trades_kept: kept,
    trades_skipped: total - kept,
    trades_shrunk: shrunk,
    skip_rate: total === 0 ? 0 : (total - kept) / total,
    precision: precision(overall),
    recall: recall(overall),
  };
}

export function evaluateOverlay(
  input: WalkForwardInput,
  options: OverlayEvaluationOptions = {},
): OverlayEvaluation {
  const wf = options.walkForward ?? runWalkForward(input);
  const policy = options.policy ?? defaultTradePolicy;
  const scoring = resolveScoringConfig(options.scoring);
  const complexity = computeComplexity(input.strategy);
  const seed = options.seed ?? 1;

  const folds = buildFolds(input.candles.length, input.folds);
  const candleCounts = new Map(
    folds.map((fold) => [fold.index, fold.validEndIndex - fold.validStartIndex + 1]),
  );
  const byFold = foldPredictions(wf);

  const filteredSize = (_fold: number, _index: number, prediction: FoldPrediction) =>
    applyPolicy(prediction.probability, policy).size;

  const skipByFold = new Map<number, Set<number>>();
  const random = lcg(seed);
  for (const fold of [...byFold.keys()].sort((a, b) => a - b)) {
    const predictions = byFold.get(fold) ?? [];
    const skipCount = predictions.filter(
      (prediction) => applyPolicy(prediction.probability, policy).size <= 0,
    ).length;
    skipByFold.set(fold, seededPick(predictions.length, skipCount, random));
  }
  const randomSize = (fold: number, indexInFold: number) =>
    skipByFold.get(fold)?.has(indexInFold) ? 0 : 1;

  return {
    symbol: input.symbol,
    feature_set_id: wf.feature_set_id,
    seed,
    policy,
    guardrails: evaluateGuardrails(wf),
    take_everything: buildPolicyEvaluation(
      "take_everything",
      input.symbol,
      byFold,
      () => 1,
      candleCounts,
      scoring,
      complexity,
    ),
    filtered: buildPolicyEvaluation(
      "filtered",
      input.symbol,
      byFold,
      filteredSize,
      candleCounts,
      scoring,
      complexity,
    ),
    random_skip: buildPolicyEvaluation(
      "random_skip",
      input.symbol,
      byFold,
      randomSize,
      candleCounts,
      scoring,
      complexity,
    ),
    walk_forward: wf,
    artifact: buildOverlayArtifact(input, wf, { policy, seed }),
  };
}
