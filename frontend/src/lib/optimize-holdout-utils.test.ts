import assert from "node:assert/strict";
import test from "node:test";

import type { FoldEvaluation } from "@/lib/api-optimization-types";
import type { HoldoutEvaluation, OptimizationExperimentRecord } from "@/lib/api-types";
import { holdoutComparisonRows, holdoutWindowSummary } from "./optimize-holdout-utils.ts";

function result(symbol: string, returnPct: number): FoldEvaluation {
  return {
    symbol,
    foldIndex: 0,
    objectiveValue: returnPct,
    total_return_pct: returnPct,
    annualized_return_pct: null,
    sharpe_ratio: 1,
    max_drawdown_pct: -3,
    trade_count: 5,
    candle_count: 80,
  };
}

function recordWithHoldout(fraction: number | null): OptimizationExperimentRecord {
  return {
    config: {
      ...(fraction == null ? {} : { holdout: { fraction } }),
    },
    snapshot: {
      strategy_name: "Test",
      datasets: [
        { ticker: "AAA", candle_count: 400, first_candle_ms: 0, last_candle_ms: 1, holdout_candle_count: 80 },
        { ticker: "BBB", candle_count: 200, first_candle_ms: 0, last_candle_ms: 1, holdout_candle_count: 40 },
      ],
    },
  } as OptimizationExperimentRecord;
}

test("holdoutWindowSummary sums sealed candles across symbols", () => {
  const summary = holdoutWindowSummary(recordWithHoldout(0.2));
  assert.deepEqual(summary, { sealedCandles: 120, totalCandles: 600, fractionPct: 20 });
});

test("holdoutWindowSummary is null without a holdout config", () => {
  assert.equal(holdoutWindowSummary(recordWithHoldout(null)), null);
});

test("holdoutComparisonRows groups per symbol with the candidate first", () => {
  const evaluation: HoldoutEvaluation = {
    trial_index: 2,
    opened_at: "2026-07-11T00:00:00.000Z",
    candidate: [result("AAA", 4), result("BBB", 6)],
    baseline: [result("AAA", 2), result("BBB", 1)],
    buy_hold: [result("AAA", 3), result("BBB", -1)],
  };
  const rows = holdoutComparisonRows(evaluation);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["AAA:Candidate", "AAA:Baseline", "AAA:Buy & hold", "BBB:Candidate", "BBB:Baseline", "BBB:Buy & hold"],
  );
  assert.equal(rows[0].returnPct, 4);
  assert.equal(rows[0].trades, 5);
  assert.equal(rows[3].returnPct, 6);
});
