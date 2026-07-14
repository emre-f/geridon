import assert from "node:assert/strict";
import { test } from "node:test";

import { handleGetRuleLibrary } from "../src/api/optimizationRuleLibrary.ts";
import { canonicalRuleKey, ruleRejectionReason } from "../src/services/optimization/cheapRejection.ts";
import {
  buildRuleLibraryTemplates,
  collectInsertionPoints,
} from "../src/services/optimization/ruleLibrary.ts";
import { validateCandidate } from "../src/services/optimization/searchSpace.ts";
import { validateRule } from "../src/services/strategies.ts";
import { makeDb } from "./experimentTestHelpers.ts";
import { thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { RuleLibraryResponse, Strategy, StrategyRule } from "../src/types.ts";

test("every seeded template is a valid, non-degenerate, catalog-bounded rule", () => {
  const templates = buildRuleLibraryTemplates(thresholdStrategy(95, 105));
  assert.ok(templates.length >= 15);

  const seen = new Set<string>();
  for (const entry of templates) {
    const { rule, errors } = validateRule(entry.rule, "rule");
    assert.deepEqual(errors, [], entry.summary);
    assert.ok(rule);
    assert.equal(ruleRejectionReason(entry.rule), null, entry.summary);

    const wrapped: Strategy = {
      name: "Wrapper",
      entry: entry.rule,
      exit: thresholdRule("gt", 105) as StrategyRule,
    };
    assert.equal(validateCandidate(wrapped, "long_only"), null, entry.summary);

    const key = canonicalRuleKey(entry.rule);
    assert.ok(!seen.has(key), `duplicate template ${entry.summary}`);
    seen.add(key);
    assert.ok(entry.summary.length > 0);
    assert.ok(entry.label && entry.label.length > 0, entry.summary);
    assert.ok(!entry.label.includes("cross_above") && !entry.label.includes("_"), entry.label);
  }
});

test("rule labels read as prose built from catalog names", () => {
  const templates = buildRuleLibraryTemplates(thresholdStrategy(95, 105));
  const labels = new Map(templates.map((entry) => [entry.summary, entry.label]));
  assert.equal(labels.get("sma(20).sma cross_above sma(50).sma"), "SMA(20) crosses above SMA(50)");
  assert.equal(labels.get("rsi(14).rsi lt 30"), "RSI(14) is less than 30");
  assert.equal(
    labels.get("close cross_below bollinger(20,2).lower"),
    "Close crosses below BB(20, 2) Lower",
  );
});

test("templates already present in the strategy are filtered out", () => {
  const rsiRule: StrategyRule = {
    type: "rule",
    left: { type: "indicator", kind: "rsi", parameters: { period: 14 }, output: "rsi" },
    operator: "lt",
    right: { type: "value", value: 30 },
  };
  const strategy: Strategy = {
    name: "RSI dip",
    entry: rsiRule,
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
  const templates = buildRuleLibraryTemplates(strategy);
  const key = canonicalRuleKey(rsiRule);
  assert.ok(templates.every((entry) => canonicalRuleKey(entry.rule) !== key));
});

test("insertion points list enabled and/or groups only", () => {
  const strategy: Strategy = {
    name: "Groups",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        thresholdRule("lt", 95),
        {
          type: "group",
          operator: "or",
          conditions: [thresholdRule("lt", 93), thresholdRule("lt", 91)],
        },
        {
          type: "group",
          operator: "at_least",
          count: 1,
          conditions: [thresholdRule("lt", 92)],
        },
        {
          type: "group",
          operator: "and",
          enabled: false,
          conditions: [thresholdRule("lt", 90)],
        },
      ],
    },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };

  const points = collectInsertionPoints(strategy);
  assert.deepEqual(
    points.map((point) => [point.id, point.side, point.operator, point.size]),
    [
      ["entry", "entry", "and", 4],
      ["entry.conditions.1", "entry", "or", 2],
    ],
  );
});

test("rule-library endpoint serves templates, insertion points, and limits", () => {
  const db = makeDb();
  const strategy = thresholdStrategy(95, 105);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const strategyId = Number(inserted.lastInsertRowid);

  const result = handleGetRuleLibrary(db, String(strategyId));
  assert.equal(result.statusCode, 200);
  const body = result.body as RuleLibraryResponse;
  assert.equal(body.strategy_id, strategyId);
  assert.ok(body.templates.length > 0);
  // Bare-rule entry and exit offer nowhere to insert.
  assert.deepEqual(body.insertion_points, []);
  assert.equal(body.cap_defaults.maxNewRulesPerSide, 2);
  assert.equal(body.cap_defaults.maxTreeDepth, 3);
  assert.ok(body.limits.maxRuleLibrary >= body.templates.length);

  assert.equal(handleGetRuleLibrary(db, "abc").statusCode, 400);
  assert.equal(handleGetRuleLibrary(db, null).statusCode, 400);
  assert.equal(handleGetRuleLibrary(db, "999").statusCode, 404);
});

test("cap defaults are raised so they never exclude the baseline strategy", () => {
  const db = makeDb();
  const smaRule = (period: number): StrategyRule => ({
    type: "rule",
    left: { type: "indicator", kind: "sma", parameters: { period }, output: "sma" },
    operator: "gt",
    right: { type: "value", value: 100 },
  });
  const strategy: Strategy = {
    name: "Five indicators",
    entry: {
      type: "group",
      operator: "and",
      conditions: [5, 10, 20, 50, 100].map(smaRule),
    },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));

  const result = handleGetRuleLibrary(db, String(inserted.lastInsertRowid));
  assert.equal(result.statusCode, 200);
  const body = result.body as RuleLibraryResponse;
  assert.equal(body.cap_defaults.maxUniqueIndicatorsPerSide, 5);
  assert.equal(body.cap_defaults.maxActiveRulesPerSide, 6);
  assert.equal(body.cap_defaults.maxTreeDepth, 3);
});
