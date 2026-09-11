import type { Database } from "../../db.ts";
import type { TradeCosts } from "../../types/backtests.ts";
import type { CloseBar } from "../forwardReturns.ts";
import { computeCostLine, type CostLine } from "./costLine.ts";
import {
  selectEvents,
  type EventSelectionOptions,
  type EventSelectionStats,
  type SelectedEvent,
} from "./eventSelection.ts";
import type { EventStudyResult, StudyEvent } from "./eventStudy.ts";
import { summarizeHorizons, type HorizonSummary } from "./horizonSummary.ts";
import { computeVerdict, type SignalHeadlineStats, type SignalVerdict } from "./registry.ts";
import {
  assembleScoreAnalysis,
  planBuckets,
  planScoreAnalysis,
  type ScoreAnalysis,
} from "./scoreAnalysis.ts";
import { createStudyRunner, type StudyTask } from "./studyPool.ts";

export const defaultMarketTicker = "SPY";

/** Liquid-stock frictions: 5 bps slippage per side, no commission. */
export const defaultSignalCosts: TradeCosts = {
  slippage_bps: 5,
  commission_pct: 0,
  commission_per_trade: 0,
};

export interface EvaluateSignalOptions {
  query: EventSelectionOptions;
  seed: number;
  costs?: TradeCosts;
  notionalPerEvent?: number;
  marketTicker?: string;
  /** Above 1, bucket studies fan across worker threads; output is identical either way. */
  workerCount?: number;
  maxHorizon?: number;
  bootstrapIterations?: number;
  quantiles?: number;
  flagFields?: readonly string[];
  referenceHorizon?: number;
}

export interface SignalEvaluationPackage {
  query: EventSelectionOptions;
  seed: number;
  selection: EventSelectionStats;
  study: EventStudyResult;
  horizon_summary: HorizonSummary;
  cost_line: CostLine;
  score_analysis: ScoreAnalysis;
  headline: SignalHeadlineStats;
  verdict: SignalVerdict;
}

/**
 * The Milestone D entry point: one call from event query to the full evidence
 * package — selection, pooled event study, horizon summary, cost line, score
 * buckets, headline stats, verdict. Deterministic for a given database, query,
 * and seed: worker pool on or off, event insertion order shuffled or not, the
 * output JSON is byte-identical. Headline stats coalesce missing values to 0
 * so an empty or dataless selection reads as no_signal, never as a crash.
 */
export async function evaluateEventSignal(
  db: Database,
  options: EvaluateSignalOptions,
): Promise<SignalEvaluationPackage> {
  const selection = selectEvents(db, options.query);
  const marketBars = loadMarketBars(db, options.marketTicker ?? defaultMarketTicker);
  const plan = planScoreAnalysis(selection.events, options);

  const shared = {
    seed: options.seed,
    maxHorizon: options.maxHorizon,
    bootstrapIterations: options.bootstrapIterations,
  };
  const tasks: StudyTask[] = [
    { events: toStudyEvents(selection.events), ...shared },
    ...planBuckets(plan).map((bucket) => ({ events: toStudyEvents(bucket.events), ...shared })),
  ];

  const runner = createStudyRunner(selection.barsByTicker, marketBars, options.workerCount ?? 1);
  let studies: EventStudyResult[];
  try {
    studies = await runner.run(tasks);
  } finally {
    await runner.close();
  }
  const [study, ...bucketStudies] = studies;

  const horizonSummary = summarizeHorizons(study);
  const costLine = computeCostLine(horizonSummary, {
    costs: options.costs ?? defaultSignalCosts,
    notionalPerEvent: options.notionalPerEvent,
  });
  const headline: SignalHeadlineStats = {
    baseline_gap_t_stat: headlineTStat(study, costLine.headline_horizon),
    net_abnormal_return: costLine.net_abnormal_return ?? 0,
    n_events: study.n_events,
  };

  return {
    query: options.query,
    seed: options.seed,
    selection: selection.stats,
    study,
    horizon_summary: horizonSummary,
    cost_line: costLine,
    score_analysis: assembleScoreAnalysis(plan, bucketStudies),
    headline,
    verdict: computeVerdict(headline),
  };
}

function toStudyEvents(events: readonly SelectedEvent[]): StudyEvent[] {
  return events.map((selected) => ({
    ticker: selected.event.ticker,
    anchor_timestamp_ms: selected.anchor_timestamp_ms,
  }));
}

function headlineTStat(study: EventStudyResult, headlineHorizon: number | null): number {
  if (headlineHorizon == null) {
    return 0;
  }
  const point = study.curve.find((candidate) => candidate.horizon === headlineHorizon);
  return point?.gap_t_stat ?? 0;
}

function loadMarketBars(db: Database, ticker: string): CloseBar[] {
  const rows = db
    .prepare(`
      SELECT timestamp_ms, close
      FROM candles
      WHERE ticker = ? AND multiplier = 1 AND timespan = 'day'
      ORDER BY timestamp_ms
    `)
    .all(ticker);
  return rows.map((row) => ({
    timestamp_ms: Number(row.timestamp_ms),
    close: Number(row.close),
  }));
}
