import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalRuleKey,
  cheapRejectionReason,
  ruleRejectionReason,
} from "../src/services/optimization/cheapRejection.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { createTrial, createTrialFactory } from "../src/services/optimization/trials.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { Strategy, StrategyCondition, StrategyRule } from "../src/types.ts";

const close = { type: "price", field: "close" } as const;
const rsi = (period: number) =>
  ({ type: "indicator", kind: "rsi", parameters: { period }, output: "rsi" }) as const;

function rule(
  left: StrategyRule["left"],
  operator: StrategyRule["operator"],
  right: StrategyRule["right"],
): StrategyRule {
  return { type: "rule", left, operator, right };
}

function andStrategy(conditions: StrategyCondition[]): Strategy {
  return {
    name: "Test",
    entry: { type: "group", operator: "and", conditions },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
}

test("self-comparisons are flagged as always true or always false", async () => {
  assert.match(ruleRejectionReason(rule(close, "gt", close)) ?? "", /always false/);
  assert.match(ruleRejectionReason(rule(close, "gte", close)) ?? "", /always true/);
  assert.match(ruleRejectionReason(rule(rsi(14), "cross_above", rsi(14))) ?? "", /always false/);
  assert.equal(ruleRejectionReason(rule(rsi(14), "lt", rsi(21))), null);
  assert.equal(ruleRejectionReason(rule(close, "gt", { type: "value", value: 100 })), null);
});

test("contradictory thresholds in an and group are rejected", async () => {
  const impossible = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    rule(close, "lt", { type: "value", value: 90 }),
  ]);
  assert.match(cheapRejectionReason(impossible) ?? "", /entry: .*at the same time/);

  const strictBoundary = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    rule(close, "lte", { type: "value", value: 100 }),
  ]);
  assert.match(cheapRejectionReason(strictBoundary) ?? "", /at the same time/);

  const touchingBounds = andStrategy([
    rule(close, "gte", { type: "value", value: 100 }),
    rule(close, "lte", { type: "value", value: 100 }),
  ]);
  assert.equal(cheapRejectionReason(touchingBounds), null);

  const separateOperands = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    rule(rsi(14), "lt", { type: "value", value: 30 }),
  ]);
  assert.equal(cheapRejectionReason(separateOperands), null);
});

test("nested and groups count toward the simultaneous rule set", async () => {
  const nested = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    {
      type: "group",
      operator: "and",
      conditions: [rule(close, "lt", { type: "value", value: 90 })],
    },
  ]);
  assert.match(cheapRejectionReason(nested) ?? "", /at the same time/);

  const viaOr = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    {
      type: "group",
      operator: "or",
      conditions: [
        rule(close, "lt", { type: "value", value: 90 }),
        rule(rsi(14), "lt", { type: "value", value: 30 }),
      ],
    },
  ]);
  assert.equal(cheapRejectionReason(viaOr), null);
});

test("opposite crosses of the same pair cannot hold in one and group", async () => {
  const crossed = andStrategy([
    rule(rsi(14), "cross_above", { type: "value", value: 50 }),
    rule(rsi(14), "cross_below", { type: "value", value: 50 }),
  ]);
  assert.match(cheapRejectionReason(crossed) ?? "", /never fire on the same candle/);
});

test("duplicate rules in one group are rejected, disabled rules are ignored", async () => {
  const duplicated: Strategy = {
    name: "Test",
    entry: {
      type: "group",
      operator: "or",
      conditions: [
        rule(close, "lt", { type: "value", value: 95 }),
        rule(close, "lt", { type: "value", value: 95 }),
      ],
    },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
  assert.match(cheapRejectionReason(duplicated) ?? "", /duplicate rule/);

  const withDisabled = andStrategy([
    rule(close, "gt", { type: "value", value: 100 }),
    { ...rule(close, "lt", { type: "value", value: 90 }), enabled: false },
  ]);
  assert.equal(cheapRejectionReason(withDisabled), null);
});

test("canonical rule keys ignore parameter order", async () => {
  const left = {
    type: "indicator",
    kind: "macd",
    parameters: { fast: 12, slow: 26, signal: 9 },
    output: "macd",
  } as const;
  const reordered = {
    ...left,
    parameters: { signal: 9, fast: 12, slow: 26 },
  } as const;
  assert.equal(
    canonicalRuleKey(rule(left, "gt", { type: "value", value: 0 })),
    canonicalRuleKey(rule(reordered, "gt", { type: "value", value: 0 })),
  );
});

test("createTrial records the cheap rejection reason", async () => {
  const factory = createTrialFactory("long_only", "baseline-hash");
  const trial = createTrial(
    factory,
    andStrategy([
      rule(close, "gt", { type: "value", value: 100 }),
      rule(close, "lt", { type: "value", value: 90 }),
    ]),
    {},
    "search",
  );
  assert.equal(trial.status, "rejected");
  assert.match(trial.rejectionReason ?? "", /at the same time/);
});

test("signal-starved candidates are rejected before any fold backtest", async () => {
  // Triangle closes stay above ~89, so every sampled "close lt" entry is unreachable.
  const config = baseConfig(thresholdStrategy(5, 105), {
    method: "tpe",
    maxTrials: 12,
    refinement: { enabled: false },
    parameterOverrides: {
      "entry.right.value": { choices: [1, 5] },
      "exit.right.value": { locked: true },
    },
  });
  const result = await runOptimization(config);

  const starved = result.trials.filter((trial) =>
    /signal-starved/.test(trial.rejectionReason ?? ""),
  );
  assert.ok(starved.length > 0);
  for (const trial of starved) {
    assert.equal(trial.status, "rejected");
    assert.equal(trial.foldResults.length, 0);
    assert.equal(trial.score, null);
  }
  assert.equal(result.leaderboard.length, 0);
});
