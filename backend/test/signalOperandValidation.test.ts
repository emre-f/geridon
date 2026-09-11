import assert from "node:assert/strict";
import test from "node:test";

import { validateStrategy } from "../src/services/strategies.ts";

function strategyWith(left: Record<string, unknown>) {
  return {
    name: "Signal strategy",
    entry: {
      type: "rule",
      left,
      operator: "lte",
      right: { type: "value", value: 1 },
    },
    exit: {
      type: "rule",
      left: { type: "price", field: "close" },
      operator: "lt",
      right: { type: "value", value: 0 },
    },
  };
}

test("accepts days_since with a known kind and normalizes the operand", () => {
  const { strategy, errors } = validateStrategy(
    strategyWith({ type: "signal", kind: "insider_cluster_buy", output: "days_since" }),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual((strategy?.entry as { left: unknown }).left, {
    type: "signal",
    kind: "insider_cluster_buy",
    output: "days_since",
  });
});

test("accepts count_in_window with a window and keeps numeric filters", () => {
  const { strategy, errors } = validateStrategy(
    strategyWith({
      type: "signal",
      kind: "insider_buy",
      output: "count_in_window",
      window: 63,
      filters: { is_officer: 1, dollar_value: 50_000 },
    }),
  );

  assert.deepEqual(errors, []);
  assert.deepEqual((strategy?.entry as { left: unknown }).left, {
    type: "signal",
    kind: "insider_buy",
    output: "count_in_window",
    window: 63,
    filters: { is_officer: 1, dollar_value: 50_000 },
  });
});

test("rejects an unknown event kind", () => {
  const { strategy, errors } = validateStrategy(
    strategyWith({ type: "signal", kind: "alien_landing", output: "days_since" }),
  );

  assert.equal(strategy, null);
  assert.match(errors[0]!.message, /Unknown event kind/);
});

test("rejects an unknown output", () => {
  const { errors } = validateStrategy(
    strategyWith({ type: "signal", kind: "insider_buy", output: "sum_in_window" }),
  );

  assert.match(errors[0]!.message, /Signal output must be one of/);
});

test("count_in_window requires a positive integer window", () => {
  for (const window of [undefined, 0, -5, 2.5, "63"]) {
    const { errors } = validateStrategy(
      strategyWith({ type: "signal", kind: "insider_buy", output: "count_in_window", window }),
    );
    assert.match(errors[0]!.message, /positive integer window/);
  }
});

test("other outputs reject a window", () => {
  const { errors } = validateStrategy(
    strategyWith({ type: "signal", kind: "insider_buy", output: "last_score", window: 10 }),
  );

  assert.match(errors[0]!.message, /does not take a window/);
});

test("filters must be finite numbers and an empty filters object is dropped", () => {
  const invalid = validateStrategy(
    strategyWith({
      type: "signal",
      kind: "insider_buy",
      output: "days_since",
      filters: { is_officer: "yes" },
    }),
  );
  assert.match(invalid.errors[0]!.message, /must be a finite number/);

  const empty = validateStrategy(
    strategyWith({ type: "signal", kind: "insider_buy", output: "days_since", filters: {} }),
  );
  assert.deepEqual(empty.errors, []);
  assert.deepEqual((empty.strategy?.entry as { left: unknown }).left, {
    type: "signal",
    kind: "insider_buy",
    output: "days_since",
  });
});
