import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSignals } from "../src/services/signals.ts";
import { buildSignalSeries, collectSignalKinds } from "../src/services/signalSeries.ts";
import { bar } from "./backtestFixtures.ts";
import type { EventRecord, InsiderTransactionPayload } from "../src/types/events.ts";
import type { SignalOperand, Strategy, StrategyCondition } from "../src/types.ts";

const candles = [0, 1, 2, 3, 4, 5].map((index) => bar(index, 100 + index, 100 + index));
const hourMs = 3_600_000;

const basePayload: InsiderTransactionPayload = {
  insider_name: "Jane Doe",
  is_officer: true,
  is_director: false,
  is_ten_percent_owner: false,
  shares: 100,
  price: 10,
  dollar_value: 1_000,
};

let nextId = 1;

function buyEvent(
  availableTsMs: number,
  overrides: { score?: number | null; payload?: Partial<InsiderTransactionPayload> } = {},
): EventRecord {
  const id = nextId++;
  return {
    id,
    source: "sec_form4",
    ticker: "AAPL",
    event_kind: "insider_buy",
    event_ts_ms: availableTsMs - hourMs,
    available_ts_ms: availableTsMs,
    score: overrides.score === undefined ? 4 : overrides.score,
    payload: { ...basePayload, ...overrides.payload },
    dedupe_key: `event-${id}`,
  };
}

function operand(
  output: SignalOperand["output"],
  extra: Partial<SignalOperand> = {},
): SignalOperand {
  return { type: "signal", kind: "insider_buy", output, ...extra };
}

function signalStrategy(entry: StrategyCondition): Strategy {
  return {
    name: "Signal test",
    entry,
    exit: {
      type: "rule",
      left: { type: "value", value: 0 },
      operator: "gt",
      right: { type: "value", value: 1 },
    },
  };
}

function rule(
  left: SignalOperand,
  op: "gt" | "gte" | "lt" | "lte" | "cross_above" | "cross_below",
  value: number,
): StrategyCondition {
  return { type: "rule", left, operator: op, right: { type: "value", value } };
}

test("days_since anchors at the last bar at or before availability", () => {
  const event = buyEvent(candles[2].timestamp_ms + hourMs);
  assert.deepEqual(buildSignalSeries(operand("days_since"), [event], candles), [
    Infinity,
    Infinity,
    0,
    1,
    2,
    3,
  ]);
});

test("an event available before the first bar has no anchor and is dropped", () => {
  const event = buyEvent(candles[0].timestamp_ms - 1);
  assert.deepEqual(
    buildSignalSeries(operand("days_since"), [event], candles),
    [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity],
  );
});

test("an event available after the last bar anchors at the last bar", () => {
  const event = buyEvent(candles[5].timestamp_ms + hourMs);
  assert.deepEqual(buildSignalSeries(operand("days_since"), [event], candles), [
    Infinity,
    Infinity,
    Infinity,
    Infinity,
    Infinity,
    0,
  ]);
});

test("count_in_window counts events over the trailing window including the current bar", () => {
  const events = [buyEvent(candles[1].timestamp_ms), buyEvent(candles[3].timestamp_ms)];
  assert.deepEqual(
    buildSignalSeries(operand("count_in_window", { window: 2 }), events, candles),
    [0, 1, 1, 1, 1, 0],
  );
  assert.deepEqual(
    buildSignalSeries(operand("count_in_window", { window: 1 }), events, candles),
    [0, 1, 0, 1, 0, 0],
  );
});

test("same-bar events all count; last_score takes the latest availability", () => {
  const events = [
    buyEvent(candles[2].timestamp_ms + hourMs, { score: 1 }),
    buyEvent(candles[2].timestamp_ms + 2 * hourMs, { score: 9 }),
  ];
  assert.deepEqual(
    buildSignalSeries(operand("count_in_window", { window: 1 }), events, candles),
    [0, 0, 2, 0, 0, 0],
  );
  assert.deepEqual(buildSignalSeries(operand("last_score"), events, candles), [
    null,
    null,
    9,
    9,
    9,
    9,
  ]);
});

test("last_score is null before the first event and carries a null score forward", () => {
  const events = [
    buyEvent(candles[1].timestamp_ms, { score: 2.5 }),
    buyEvent(candles[3].timestamp_ms, { score: null }),
  ];
  assert.deepEqual(buildSignalSeries(operand("last_score"), events, candles), [
    null,
    2.5,
    2.5,
    null,
    null,
    null,
  ]);
});

test("events of other kinds are ignored", () => {
  const cluster: EventRecord = {
    ...buyEvent(candles[2].timestamp_ms),
    event_kind: "insider_cluster_buy",
    payload: {
      insider_count: 2,
      insider_names: ["A", "B"],
      window_days: 10,
      combined_dollar_value: 200_000,
    },
  };
  assert.deepEqual(
    buildSignalSeries(operand("count_in_window", { window: 1 }), [cluster], candles),
    [0, 0, 0, 0, 0, 0],
  );
});

test("payload filters use min-threshold semantics with boolean coercion", () => {
  const officer = buyEvent(candles[1].timestamp_ms, { payload: { is_officer: true } });
  const director = buyEvent(candles[3].timestamp_ms, {
    payload: { is_officer: false, is_director: true },
  });
  const filtered = operand("count_in_window", { window: 1, filters: { is_officer: 1 } });
  assert.deepEqual(buildSignalSeries(filtered, [officer, director], candles), [0, 1, 0, 0, 0, 0]);

  const missingField = operand("count_in_window", { window: 1, filters: { unknown_field: 1 } });
  assert.deepEqual(buildSignalSeries(missingField, [officer], candles), [0, 0, 0, 0, 0, 0]);
});

test("a score filter reads the score column and rejects null scores", () => {
  const strong = buyEvent(candles[1].timestamp_ms, { score: 6 });
  const weak = buyEvent(candles[3].timestamp_ms, { score: 4 });
  const unscored = buyEvent(candles[4].timestamp_ms, { score: null });
  const filtered = operand("count_in_window", { window: 1, filters: { score: 5 } });
  assert.deepEqual(
    buildSignalSeries(filtered, [strong, weak, unscored], candles),
    [0, 1, 0, 0, 0, 0],
  );
});

test("evaluateSignals throws when a signal strategy gets no events input", () => {
  const strategy = signalStrategy(rule(operand("days_since"), "lte", 1));
  assert.throws(() => evaluateSignals(strategy, candles), /events/);
});

test("an empty events list is valid and simply never fires", () => {
  const strategy = signalStrategy(rule(operand("days_since"), "lte", 1));
  assert.deepEqual(evaluateSignals(strategy, candles, undefined, []), []);
});

test("days_since is comparable as +Infinity before the first event", () => {
  const event = buyEvent(candles[2].timestamp_ms);
  const strategy = signalStrategy(rule(operand("days_since"), "gt", 100));
  assert.deepEqual(evaluateSignals(strategy, candles, undefined, [event]), [
    { timestamp_ms: candles[0].timestamp_ms, side: "buy" },
    { timestamp_ms: candles[1].timestamp_ms, side: "buy" },
  ]);
});

test("days_since crosses below the threshold exactly on the anchor bar", () => {
  const event = buyEvent(candles[2].timestamp_ms);
  const strategy = signalStrategy(rule(operand("days_since"), "cross_below", 1));
  assert.deepEqual(evaluateSignals(strategy, candles, undefined, [event]), [
    { timestamp_ms: candles[2].timestamp_ms, side: "buy" },
  ]);
});

test("collectSignalKinds walks entry, exit, and cash trees and dedupes", () => {
  const strategy: Strategy = {
    name: "Kinds",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        rule(operand("days_since"), "lte", 1),
        rule(operand("count_in_window", { window: 5 }), "gte", 2),
      ],
    },
    exit: rule({ type: "signal", kind: "insider_cluster_buy", output: "days_since" }, "gte", 10),
    cash: rule({ type: "signal", kind: "insider_sell", output: "days_since" }, "lte", 1),
  };
  assert.deepEqual(collectSignalKinds(strategy), [
    "insider_buy",
    "insider_cluster_buy",
    "insider_sell",
  ]);

  const plain: Strategy = signalStrategy({
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "gt",
    right: { type: "value", value: 1 },
  });
  assert.deepEqual(collectSignalKinds(plain), []);
});
