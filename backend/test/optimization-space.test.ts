import assert from "node:assert/strict";
import { test } from "node:test";

import { compileSearchSpace, validateCandidate } from "../src/services/optimization/searchSpace.ts";
import { strategyHash } from "../src/services/optimization/canonical.ts";
import { thresholdStrategy } from "./optimizationFixtures.ts";
import type { Strategy } from "../src/types.ts";

function macdStrategy(fast: number, slow: number): Strategy {
  return {
    name: "MACD",
    entry: {
      type: "rule",
      left: { type: "indicator", kind: "macd", parameters: { fast, slow, signal: 9 }, output: "macd" },
      operator: "cross_above",
      right: { type: "indicator", kind: "macd", parameters: { fast, slow, signal: 9 }, output: "signal" },
    },
    exit: {
      type: "rule",
      left: { type: "indicator", kind: "macd", parameters: { fast, slow, signal: 9 }, output: "macd" },
      operator: "cross_below",
      right: { type: "indicator", kind: "macd", parameters: { fast, slow, signal: 9 }, output: "signal" },
    },
  };
}

test("compiles numeric nodes centered near current values within catalog bounds", () => {
  const { nodes } = compileSearchSpace({ strategy: macdStrategy(12, 26) });
  const fastNode = nodes.find((node) => node.id === "entry.left.parameters.fast");
  assert.ok(fastNode && fastNode.kind === "numeric");
  assert.ok(fastNode.min >= 1 && fastNode.max <= 500);
  assert.ok(fastNode.min <= 12 && fastNode.max >= 12);
  assert.ok(fastNode.max - fastNode.min < 50);
});

test("value-operand thresholds become tunable nodes", () => {
  const { nodes } = compileSearchSpace({ strategy: thresholdStrategy(95, 105) });
  const threshold = nodes.find((node) => node.id === "entry.right.value");
  assert.ok(threshold && threshold.kind === "numeric");
  assert.ok(threshold.min < 95 && threshold.max > 95);
});

test("locked overrides remove nodes and choices produce categorical nodes", () => {
  const { nodes } = compileSearchSpace({
    strategy: thresholdStrategy(95, 105),
    parameterOverrides: {
      "entry.right.value": { locked: true },
      "exit.right.value": { choices: [104, 106, 108] },
    },
  });
  assert.equal(nodes.find((node) => node.id === "entry.right.value"), undefined);
  const exitNode = nodes.find((node) => node.id === "exit.right.value");
  assert.ok(exitNode && exitNode.kind === "categorical");
  assert.deepEqual(exitNode.choices, [104, 106, 108]);
});

test("rule roles: off disables in the base strategy, optional adds a toggle node", () => {
  const strategy: Strategy = {
    name: "Two rules",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdStrategy(95, 105).entry, thresholdStrategy(90, 105).entry],
    },
    exit: thresholdStrategy(95, 105).exit,
  };
  const { baseStrategy, nodes } = compileSearchSpace({
    strategy,
    ruleRoles: {
      "entry.conditions.0": "optional",
      "entry.conditions.1": "off",
    },
  });
  const toggle = nodes.find((node) => node.id === "entry.conditions.0.enabled");
  assert.ok(toggle && toggle.kind === "toggle");
  const entry = baseStrategy.entry;
  assert.ok(entry.type === "group");
  assert.equal((entry.conditions[1] as { enabled?: boolean }).enabled, false);
});

test("validateCandidate enforces catalog constraints and active rules", () => {
  assert.match(validateCandidate(macdStrategy(30, 20), "long_only") ?? "", /fast must be less/);
  assert.equal(validateCandidate(macdStrategy(12, 26), "long_only"), null);

  const disabledEntry = thresholdStrategy(95, 105);
  disabledEntry.entry = { ...disabledEntry.entry, enabled: false };
  assert.match(validateCandidate(disabledEntry, "long_only") ?? "", /entry: at least one/);
});

test("canonical hash ignores disabled rules and key order", () => {
  const strategyA = thresholdStrategy(95, 105);
  const strategyB: Strategy = {
    ...thresholdStrategy(95, 105),
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        thresholdStrategy(95, 105).entry,
        { ...thresholdStrategy(80, 105).entry, enabled: false },
      ],
    },
  };
  const strategyC = thresholdStrategy(96, 105);
  assert.notEqual(strategyHash(strategyA), strategyHash(strategyC));
  const prunedGroupHash = strategyHash(strategyB);
  assert.notEqual(prunedGroupHash, strategyHash(strategyC));
});
