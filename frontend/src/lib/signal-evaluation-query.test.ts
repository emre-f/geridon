import assert from "node:assert/strict";
import { test } from "node:test";

import type { SignalSelectionStats } from "./api-client-signals-evaluations.ts";
import {
  buildSignalQuery,
  exclusionSummary,
  initialSignalEvaluationForm,
  type SignalEvaluationFormState,
} from "./signal-evaluation-query.ts";

function form(overrides?: Partial<SignalEvaluationFormState>): SignalEvaluationFormState {
  return { ...initialSignalEvaluationForm, ...overrides };
}

test("buildSignalQuery sends only the kind when everything else is blank", () => {
  assert.deepEqual(buildSignalQuery(form()), { kind: "insider_cluster_buy" });
});

test("buildSignalQuery maps cluster filters to payload thresholds", () => {
  const query = buildSignalQuery(
    form({ minInsiderCount: "3", minCombinedDollarValue: "250000", minScore: "0.5" }),
  );
  assert.deepEqual(query, {
    kind: "insider_cluster_buy",
    min_score: 0.5,
    payload_filters: { insider_count: 3, combined_dollar_value: 250000 },
  });
});

test("buildSignalQuery maps insider filters and ignores cluster-only fields", () => {
  const query = buildSignalQuery(
    form({
      kind: "insider_buy",
      officersOnly: true,
      minDollarValue: "10000",
      minInsiderCount: "3",
    }),
  );
  assert.deepEqual(query.payload_filters, { is_officer: 1, dollar_value: 10000 });
});

test("buildSignalQuery drops unparseable numbers and negative universe values", () => {
  const query = buildSignalQuery(
    form({ minScore: "abc", minPrice: "-5", minMedianDollarVolume: "1e6" }),
  );
  assert.deepEqual(query, {
    kind: "insider_cluster_buy",
    universe: { min_median_dollar_volume: 1_000_000 },
  });
});

test("buildSignalQuery converts dates to an inclusive UTC millisecond range", () => {
  const query = buildSignalQuery(form({ startDate: "2015-01-01", endDate: "2020-12-31" }));
  assert.equal(query.start_ms, Date.UTC(2015, 0, 1));
  assert.equal(query.end_ms, Date.UTC(2021, 0, 1) - 1);
});

test("buildSignalQuery drops an end date before the start date", () => {
  const query = buildSignalQuery(form({ startDate: "2020-01-01", endDate: "2015-01-01" }));
  assert.equal(query.start_ms, Date.UTC(2020, 0, 1));
  assert.equal(query.end_ms, undefined);
});

test("exclusionSummary lists only nonzero reasons in a stable order", () => {
  const stats: SignalSelectionStats = {
    candidates: 100,
    selected: 80,
    tickers: 12,
    holdout_clamped: true,
    excluded: {
      min_score: 0,
      payload_filters: 5,
      no_anchor: 0,
      insufficient_history: 15,
      below_min_price: 0,
      below_min_dollar_volume: 0,
    },
  };
  assert.deepEqual(exclusionSummary(stats), [
    "5 failed payload filters",
    "15 too little price history",
  ]);
});
