import assert from "node:assert/strict";
import test from "node:test";

import type { StrategyDraft, StrategyRule } from "@/lib/api";
import { pendingIndicatorValidation } from "./strategy-pending.ts";

function rule(right: StrategyRule["right"]): StrategyRule {
  return {
    id: "rule-1",
    type: "rule",
    left: { type: "price", field: "close" },
    operator: "cross_above",
    right,
  };
}

test("pendingIndicatorValidation identifies unresolved indicators with their rule path", () => {
  const draft: StrategyDraft = {
    name: "Pending",
    entry: {
      id: "entry",
      type: "group",
      operator: "and",
      conditions: [rule({ type: "indicator", kind: "", parameters: {}, output: "" })],
    },
    exit: rule({ type: "value", value: 0 }),
  };

  assert.deepEqual(pendingIndicatorValidation(draft), {
    valid: false,
    errors: [{ path: "entry.conditions[0].right", message: "Select an indicator." }],
  });
});

test("pendingIndicatorValidation accepts selected indicators", () => {
  const draft: StrategyDraft = {
    name: "Complete",
    entry: rule({ type: "indicator", kind: "sma", parameters: { period: 20 }, output: "sma" }),
    exit: rule({ type: "value", value: 0 }),
  };

  assert.equal(pendingIndicatorValidation(draft), null);
});
