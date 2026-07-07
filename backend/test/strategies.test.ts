import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStrategy, validateStrategy } from "../src/services/strategies.ts";

// Returns untyped JSON on purpose: the tests mutate it into invalid shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function goldenCross(): any {
  return {
    name: "Golden cross",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        {
          type: "rule",
          left: { type: "indicator", kind: "sma", parameters: { period: 50 } },
          operator: "cross_above",
          right: { type: "indicator", kind: "sma", parameters: { period: 200 } },
        },
      ],
    },
    exit: {
      type: "rule",
      left: { type: "indicator", kind: "sma", parameters: { period: 50 } },
      operator: "cross_below",
      right: { type: "indicator", kind: "sma", parameters: { period: 200 } },
    },
  };
}

test("validateStrategy accepts a valid strategy and applies defaults", () => {
  const { strategy, errors } = validateStrategy(goldenCross());

  assert.deepEqual(errors, []);
  assert.ok(strategy);
  assert.equal(strategy.name, "Golden cross");

  const entry = strategy.entry;
  assert.equal(entry.type, "group");
  const rule = entry.type === "group" ? entry.conditions[0] : null;
  assert.ok(rule && rule.type === "rule");
  if (rule.type === "rule" && rule.left.type === "indicator") {
    // Missing output falls back to the definition's first value key.
    assert.equal(rule.left.output, "sma");
    assert.deepEqual(rule.left.parameters, { period: 50 });
  }
});

test("validateStrategy accepts price, value operands and nested NOT groups", () => {
  const { strategy, errors } = validateStrategy({
    name: "RSI dip",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        {
          type: "rule",
          left: { type: "indicator", kind: "rsi", parameters: { period: 14 } },
          operator: "cross_below",
          right: { type: "value", value: 30 },
        },
        {
          type: "group",
          operator: "not",
          conditions: [
            {
              type: "rule",
              left: { type: "price", field: "close" },
              operator: "lt",
              right: { type: "indicator", kind: "sma", parameters: { period: 200 } },
            },
          ],
        },
      ],
    },
    exit: {
      type: "rule",
      left: { type: "indicator", kind: "rsi", parameters: { period: 14 } },
      operator: "gt",
      right: { type: "value", value: 70 },
    },
  });

  assert.deepEqual(errors, []);
  assert.ok(strategy);
});

test("validateStrategy keeps enabled only when false and rejects non-boolean values", () => {
  const disabled = goldenCross();
  disabled.entry.conditions[0].enabled = false;
  disabled.exit.enabled = true;

  const { strategy, errors } = validateStrategy(disabled);
  assert.deepEqual(errors, []);
  assert.ok(strategy);
  const rule = strategy.entry.type === "group" ? strategy.entry.conditions[0] : null;
  assert.ok(rule);
  assert.equal(rule.enabled, false);
  // enabled: true is the default, so it is not stored.
  assert.ok(!("enabled" in strategy.exit));

  const invalid = goldenCross();
  invalid.entry.enabled = "yes";
  const result = validateStrategy(invalid);
  assert.equal(result.strategy, null);
  assert.deepEqual(result.errors, [
    { path: "entry", message: "Condition enabled flag must be a boolean." },
  ]);
});

test("validateStrategy requires name, entry, and exit", () => {
  const { strategy, errors } = validateStrategy({});

  assert.equal(strategy, null);
  assert.deepEqual(
    errors.map((error) => error.path),
    ["name", "entry", "exit"],
  );
});

test("validateStrategy rejects unknown indicator kinds and outputs with paths", () => {
  const invalid = goldenCross();
  invalid.entry.conditions[0].left = { type: "indicator", kind: "vwap", parameters: {} };
  invalid.exit.right = { type: "indicator", kind: "macd", output: "nope", parameters: {} };

  const { strategy, errors } = validateStrategy(invalid);

  assert.equal(strategy, null);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].path, "entry.conditions[0].left");
  assert.match(errors[0].message, /Unsupported indicator kind/);
  assert.equal(errors[1].path, "exit.right");
  assert.match(errors[1].message, /Unknown macd output/);
});

test("validateStrategy rejects invalid operators and parameters", () => {
  const invalid = goldenCross();
  invalid.entry.conditions[0].operator = "equals";
  invalid.exit.left = { type: "indicator", kind: "macd", parameters: { fast: 30, slow: 10 } };

  const { errors } = validateStrategy(invalid);

  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Unsupported operator/);
  assert.equal(errors[1].path, "exit.left");
  assert.match(errors[1].message, /macd.fast must be less than macd.slow/);
});

test("validateStrategy rejects rules that never change", () => {
  const invalid = goldenCross();
  invalid.exit = {
    type: "rule",
    left: { type: "value", value: 1 },
    operator: "gt",
    right: { type: "value", value: 2 },
  };

  const { errors } = validateStrategy(invalid);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, "exit");
  assert.match(errors[0].message, /cannot compare two fixed values/);
});

test("validateStrategy rejects cross rules with a fixed value on the left", () => {
  const invalid = goldenCross();
  invalid.exit = {
    type: "rule",
    left: { type: "value", value: 30 },
    operator: "cross_above",
    right: { type: "indicator", kind: "rsi", parameters: { period: 14 } },
  };

  const { errors } = validateStrategy(invalid);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, "exit.left");
  assert.match(errors[0].message, /indicator or price series on the left/);
});

test("validateStrategy rejects malformed groups", () => {
  const emptyGroup = goldenCross();
  emptyGroup.entry = { type: "group", operator: "and", conditions: [] };
  assert.match(validateStrategy(emptyGroup).errors[0].message, /at least one condition/);

  const badNot = goldenCross();
  badNot.entry = {
    type: "group",
    operator: "not",
    conditions: [goldenCross().exit, goldenCross().exit],
  };
  assert.match(validateStrategy(badNot).errors[0].message, /exactly one condition/);

  const badOperator = goldenCross();
  badOperator.entry = { type: "group", operator: "xor", conditions: [goldenCross().exit] };
  assert.match(validateStrategy(badOperator).errors[0].message, /Group operator must be/);
});

test("validateStrategy limits group nesting depth", () => {
  let condition: Record<string, unknown> = goldenCross().exit;
  for (let level = 0; level < 8; level += 1) {
    condition = { type: "group", operator: "and", conditions: [condition] };
  }

  const deep = goldenCross();
  deep.entry = condition as never;
  const { errors } = validateStrategy(deep);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /nested at most/);
});

test("normalizeStrategy throws on the first issue", () => {
  assert.throws(() => normalizeStrategy({ name: "" }), /Strategy name is required/);
  assert.ok(normalizeStrategy(goldenCross()));
});
