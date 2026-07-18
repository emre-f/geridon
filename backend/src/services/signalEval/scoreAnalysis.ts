import type { CloseBar } from "../forwardReturns.ts";
import type { SelectedEvent } from "./eventSelection.ts";
import { runEventStudy, type EventStudyResult } from "./eventStudy.ts";
import { summarizeHorizons } from "./horizonSummary.ts";

export const defaultScoreQuantiles = 3;
export const defaultReferenceHorizon = 21;
export const defaultFlagFields = ["is_officer", "is_director"] as const;

export interface ScoreAnalysisPlanOptions {
  quantiles?: number;
  flagFields?: readonly string[];
  referenceHorizon?: number;
}

export interface ScoreAnalysisOptions extends ScoreAnalysisPlanOptions {
  events: readonly SelectedEvent[];
  barsByTicker: ReadonlyMap<string, readonly CloseBar[]>;
  marketBars: readonly CloseBar[];
  seed: number;
  maxHorizon?: number;
  bootstrapIterations?: number;
}

export interface BucketPlan {
  label: string;
  events: SelectedEvent[];
}

export interface ScoreAnalysisPlan {
  reference_horizon: number;
  unscored_events: number;
  quantile_buckets: BucketPlan[];
  flag_splits: Array<{
    field: string;
    with_flag: BucketPlan;
    without_flag: BucketPlan;
    missing_events: number;
  }>;
}

export interface BucketStudy {
  label: string;
  n_events: number;
  min_score: number | null;
  max_score: number | null;
  reference_gap: number | null;
  peak_gap: number | null;
  natural_holding_period_bars: number | null;
}

export interface FlagSplit {
  field: string;
  with_flag: BucketStudy;
  without_flag: BucketStudy;
  missing_events: number;
}

export interface ScoreAnalysis {
  reference_horizon: number;
  unscored_events: number;
  score_buckets: BucketStudy[];
  monotonic_in_score: boolean | null;
  flag_splits: FlagSplit[];
}

/**
 * Decides bucket membership only; running the studies is the caller's problem,
 * so the orchestrator can fan every bucket across the worker pool in one
 * batch. The scored sort ends on `dedupe_key` so membership is deterministic
 * regardless of database insertion order. Events with a null score are
 * counted, never guessed into a bucket; so are events missing a flag field.
 */
export function planScoreAnalysis(
  events: readonly SelectedEvent[],
  options: ScoreAnalysisPlanOptions = {},
): ScoreAnalysisPlan {
  const quantiles = options.quantiles ?? defaultScoreQuantiles;
  const flagFields = options.flagFields ?? defaultFlagFields;

  const scored = events
    .filter((selected) => selected.event.score != null)
    .sort(
      (left, right) =>
        (left.event.score as number) - (right.event.score as number) ||
        left.event.ticker.localeCompare(right.event.ticker) ||
        left.anchor_timestamp_ms - right.anchor_timestamp_ms ||
        left.event.dedupe_key.localeCompare(right.event.dedupe_key),
    );

  const quantileBuckets: BucketPlan[] = [];
  for (let bucket = 0; bucket < quantiles; bucket += 1) {
    const start = Math.floor((bucket * scored.length) / quantiles);
    const end = Math.floor(((bucket + 1) * scored.length) / quantiles);
    quantileBuckets.push({ label: `q${bucket + 1}`, events: scored.slice(start, end) });
  }

  const flagSplits = flagFields.map((field) => {
    const withFlag: SelectedEvent[] = [];
    const withoutFlag: SelectedEvent[] = [];
    let missing = 0;
    for (const selected of events) {
      const value = flagValue(selected.event.payload, field);
      if (value == null) {
        missing += 1;
      } else if (value) {
        withFlag.push(selected);
      } else {
        withoutFlag.push(selected);
      }
    }
    return {
      field,
      with_flag: { label: `${field}=true`, events: withFlag },
      without_flag: { label: `${field}=false`, events: withoutFlag },
      missing_events: missing,
    };
  });

  return {
    reference_horizon: options.referenceHorizon ?? defaultReferenceHorizon,
    unscored_events: events.length - scored.length,
    quantile_buckets: quantileBuckets,
    flag_splits: flagSplits,
  };
}

/** The plan's buckets in the fixed order `assembleScoreAnalysis` consumes. */
export function planBuckets(plan: ScoreAnalysisPlan): BucketPlan[] {
  return [
    ...plan.quantile_buckets,
    ...plan.flag_splits.flatMap((split) => [split.with_flag, split.without_flag]),
  ];
}

export function assembleScoreAnalysis(
  plan: ScoreAnalysisPlan,
  studies: readonly EventStudyResult[],
): ScoreAnalysis {
  const buckets = planBuckets(plan);
  if (studies.length !== buckets.length) {
    throw new Error(
      `Expected ${buckets.length} bucket studies in planBuckets order, got ${studies.length}.`,
    );
  }
  const byBucket = buckets.map((bucket, index) =>
    assembleBucket(bucket, studies[index], plan.reference_horizon),
  );

  const scoreBuckets = byBucket.slice(0, plan.quantile_buckets.length);
  let cursor = plan.quantile_buckets.length;
  const flagSplits = plan.flag_splits.map((split) => {
    const withFlag = byBucket[cursor];
    const withoutFlag = byBucket[cursor + 1];
    cursor += 2;
    return {
      field: split.field,
      with_flag: withFlag,
      without_flag: withoutFlag,
      missing_events: split.missing_events,
    };
  });

  return {
    reference_horizon: plan.reference_horizon,
    unscored_events: plan.unscored_events,
    score_buckets: scoreBuckets,
    monotonic_in_score: monotonicInScore(scoreBuckets),
    flag_splits: flagSplits,
  };
}

/**
 * Splits the selected events into score quantile buckets (low → high) and by
 * payload flags, running the full event study per bucket. A believable signal
 * is stronger in the stronger bucket: `monotonic_in_score` is true when the
 * gap at the reference horizon strictly increases across buckets, and null
 * when any bucket cannot report one (too few events, missing bars).
 */
export function analyzeScoreBuckets(options: ScoreAnalysisOptions): ScoreAnalysis {
  const plan = planScoreAnalysis(options.events, options);
  const studies = planBuckets(plan).map((bucket) =>
    runEventStudy({
      events: bucket.events.map((selected) => ({
        ticker: selected.event.ticker,
        anchor_timestamp_ms: selected.anchor_timestamp_ms,
      })),
      barsByTicker: options.barsByTicker,
      marketBars: options.marketBars,
      seed: options.seed,
      maxHorizon: options.maxHorizon,
      bootstrapIterations: options.bootstrapIterations,
    }),
  );
  return assembleScoreAnalysis(plan, studies);
}

function assembleBucket(
  bucket: BucketPlan,
  study: EventStudyResult,
  referenceHorizon: number,
): BucketStudy {
  const summary = summarizeHorizons(study);
  const scores = bucket.events
    .map((selected) => selected.event.score)
    .filter((score): score is number => score != null);
  return {
    label: bucket.label,
    n_events: bucket.events.length,
    min_score: scores.length > 0 ? Math.min(...scores) : null,
    max_score: scores.length > 0 ? Math.max(...scores) : null,
    reference_gap: study.curve.find((point) => point.horizon === referenceHorizon)?.gap ?? null,
    peak_gap: summary.peak_gap,
    natural_holding_period_bars: summary.natural_holding_period_bars,
  };
}

function monotonicInScore(buckets: readonly BucketStudy[]): boolean | null {
  if (buckets.length < 2 || buckets.some((bucket) => bucket.reference_gap == null)) {
    return null;
  }
  return buckets.every(
    (bucket, index) =>
      index === 0 || (bucket.reference_gap as number) > (buckets[index - 1].reference_gap as number),
  );
}

function flagValue(payload: object, field: string): boolean | null {
  const raw = (payload as Record<string, unknown>)[field];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    return raw !== 0;
  }
  return null;
}
