import assert from "node:assert/strict";
import test from "node:test";

import type { CloseBar } from "../src/services/forwardReturns.ts";
import type { SelectedEvent } from "../src/services/signalEval/eventSelection.ts";
import {
  analyzeScoreBuckets,
  type ScoreAnalysisOptions,
} from "../src/services/signalEval/scoreAnalysis.ts";
import type { InsiderTransactionPayload } from "../src/types/events.ts";

const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2020, 0, 1);
const barMs = (index: number) => firstBarMs + index * dayMs;
const anchorIndex = 10;

function bars(postAnchorReturn: number, count = 15): CloseBar[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp_ms: barMs(index),
    close: index >= anchorIndex + 2 ? 100 * (1 + postAnchorReturn) : 100,
  }));
}

function selected(
  ticker: string,
  score: number | null,
  payload: Partial<InsiderTransactionPayload> = {},
): SelectedEvent {
  return {
    event: {
      source: "sec_form4",
      ticker,
      event_kind: "insider_buy",
      event_ts_ms: barMs(anchorIndex - 1),
      available_ts_ms: barMs(anchorIndex),
      score,
      payload: payload as InsiderTransactionPayload,
      dedupe_key: `${ticker}-${score}`,
    },
    anchor_timestamp_ms: barMs(anchorIndex),
    actionable_timestamp_ms: barMs(anchorIndex + 1),
  };
}

function scenario(returnsByTicker: Record<string, number>): {
  barsByTicker: Map<string, CloseBar[]>;
  marketBars: CloseBar[];
} {
  return {
    barsByTicker: new Map(
      Object.entries(returnsByTicker).map(([ticker, planted]) => [ticker, bars(planted)]),
    ),
    marketBars: bars(0),
  };
}

const closeTo = (actual: number | null, expected: number, label: string) => {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-12, `${label}: ${actual}`);
};

function options(
  events: SelectedEvent[],
  returnsByTicker: Record<string, number>,
  overrides: Partial<ScoreAnalysisOptions> = {},
): ScoreAnalysisOptions {
  return {
    events,
    ...scenario(returnsByTicker),
    seed: 1,
    referenceHorizon: 1,
    maxHorizon: 2,
    bootstrapIterations: 10,
    ...overrides,
  };
}

test("score buckets split low to high and detect a monotonic signal", () => {
  const result = analyzeScoreBuckets(
    options(
      [selected("CCC", 3), selected("AAA", 1), selected("BBB", 2)],
      { AAA: 0, BBB: 0.05, CCC: 0.1 },
    ),
  );

  assert.equal(result.score_buckets.length, 3);
  assert.deepEqual(
    result.score_buckets.map((bucket) => [bucket.label, bucket.n_events, bucket.min_score]),
    [["q1", 1, 1], ["q2", 1, 2], ["q3", 1, 3]],
  );
  closeTo(result.score_buckets[0].reference_gap, 0, "q1");
  closeTo(result.score_buckets[1].reference_gap, 0.05, "q2");
  closeTo(result.score_buckets[2].reference_gap, 0.1, "q3");
  assert.equal(result.monotonic_in_score, true);
  assert.equal(result.unscored_events, 0);
});

test("a signal weaker in the stronger bucket is not monotonic", () => {
  const result = analyzeScoreBuckets(
    options(
      [selected("AAA", 1), selected("BBB", 2), selected("CCC", 3)],
      { AAA: 0.1, BBB: 0.05, CCC: 0 },
    ),
  );
  assert.equal(result.monotonic_in_score, false);
});

test("an empty bucket makes the monotonicity call null, not a guess", () => {
  const result = analyzeScoreBuckets(
    options([selected("AAA", 1), selected("BBB", 2)], { AAA: 0, BBB: 0.05 }),
  );
  assert.equal(result.score_buckets[0].n_events, 0);
  assert.equal(result.score_buckets[0].reference_gap, null);
  assert.equal(result.monotonic_in_score, null);
});

test("unscored events are counted and excluded from every score bucket", () => {
  const result = analyzeScoreBuckets(
    options(
      [selected("AAA", 1), selected("BBB", 2), selected("CCC", 3), selected("DDD", null)],
      { AAA: 0, BBB: 0.05, CCC: 0.1, DDD: 0.5 },
    ),
  );
  assert.equal(result.unscored_events, 1);
  assert.equal(
    result.score_buckets.reduce((total, bucket) => total + bucket.n_events, 0),
    3,
  );
});

test("flag splits separate with/without and count missing fields", () => {
  const result = analyzeScoreBuckets(
    options(
      [
        selected("WA", 1, { is_officer: true }),
        selected("WB", 2, { is_officer: true }),
        selected("XA", 1, { is_officer: false }),
        selected("XB", 2, { is_officer: false }),
        selected("MM", 1),
      ],
      { WA: 0.1, WB: 0.1, XA: 0, XB: 0, MM: 0.5 },
      { flagFields: ["is_officer"] },
    ),
  );

  assert.equal(result.flag_splits.length, 1);
  const split = result.flag_splits[0];
  assert.equal(split.field, "is_officer");
  assert.equal(split.with_flag.n_events, 2);
  assert.equal(split.without_flag.n_events, 2);
  assert.equal(split.missing_events, 1);
  closeTo(split.with_flag.reference_gap, 0.1, "with");
  closeTo(split.without_flag.reference_gap, 0, "without");
});

test("same inputs and seed produce identical analyses", () => {
  const events = [
    selected("AAA", 1, { is_officer: true }),
    selected("BBB", 2, { is_officer: false }),
    selected("CCC", 3, { is_officer: true }),
  ];
  const returns = { AAA: 0.02, BBB: 0.05, CCC: 0.1 };
  const first = analyzeScoreBuckets(options(events, returns));
  const second = analyzeScoreBuckets(options([...events].reverse(), returns));
  assert.deepEqual(first, second);
});
