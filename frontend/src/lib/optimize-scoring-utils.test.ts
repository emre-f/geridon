import assert from "node:assert/strict";
import { test } from "node:test";

import type { ScoringConfig } from "./api-optimization-types.ts";
import {
  buildScoringConfig,
  defaultScoring,
  scoringIssue,
  scoringSummary,
} from "./optimize-scoring-utils.ts";

function edit(overrides?: Partial<ScoringConfig>): ScoringConfig {
  return {
    objective: defaultScoring.objective,
    penalties: { ...defaultScoring.penalties },
    constraints: { ...defaultScoring.constraints },
    ...overrides,
  };
}

test("buildScoringConfig returns undefined when everything matches the defaults", () => {
  assert.equal(buildScoringConfig(edit()), undefined);
});

test("buildScoringConfig sends only the deviating sections", () => {
  const objectiveOnly = buildScoringConfig(edit({ objective: "total_return" }));
  assert.deepEqual(objectiveOnly, { objective: "total_return" });

  const custom = edit({
    penalties: { ...defaultScoring.penalties, drawdown: 0.05 },
    constraints: { ...defaultScoring.constraints, minTotalTrades: 10 },
  });
  const built = buildScoringConfig(custom);
  assert.equal(built?.objective, undefined);
  assert.deepEqual(built?.penalties, { ...defaultScoring.penalties, drawdown: 0.05 });
  assert.deepEqual(built?.constraints, { ...defaultScoring.constraints, minTotalTrades: 10 });
});

test("scoringIssue accepts the defaults and flags out-of-bounds values", () => {
  assert.equal(scoringIssue(edit()), null);
  assert.match(
    scoringIssue(edit({ penalties: { ...defaultScoring.penalties, turnover: -0.1 } }))!,
    /turnover/,
  );
  assert.match(
    scoringIssue(edit({ penalties: { ...defaultScoring.penalties, drawdown: 11 } }))!,
    /drawdown/,
  );
  assert.match(
    scoringIssue(edit({ constraints: { ...defaultScoring.constraints, minTotalTrades: 2.5 } }))!,
    /trades/,
  );
  assert.match(
    scoringIssue(edit({ constraints: { ...defaultScoring.constraints, maxDrawdownPct: 120 } }))!,
    /drawdown/i,
  );
  assert.match(
    scoringIssue(
      edit({ constraints: { ...defaultScoring.constraints, minPositiveFoldFraction: 1.2 } }),
    )!,
    /positive folds/i,
  );
});

test("scoringSummary reflects the objective and customization state", () => {
  assert.equal(scoringSummary(edit()), "Sharpe ratio · default penalties · default constraints");
  assert.equal(
    scoringSummary(
      edit({
        objective: "annualized_return",
        penalties: { ...defaultScoring.penalties, complexity: 0.1 },
      }),
    ),
    "Annualized return · custom penalties · default constraints",
  );
});
