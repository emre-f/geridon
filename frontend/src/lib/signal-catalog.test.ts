import assert from "node:assert/strict";
import test from "node:test";

import type { SignalOperand } from "@/lib/api-strategy-types";
import {
  defaultSignalOperand,
  signalCatalog,
  signalKindLabel,
  signalOperandSummary,
} from "./signal-catalog.ts";

test("defaultSignalOperand starts on the first catalog kind with days_since", () => {
  assert.deepEqual(defaultSignalOperand(), {
    type: "signal",
    kind: signalCatalog[0].kind,
    output: "days_since",
  });
});

test("signalKindLabel falls back to title case for unknown kinds", () => {
  assert.equal(signalKindLabel("insider_cluster_buy"), "Insider Cluster Buy");
  assert.equal(signalKindLabel("earnings_surprise"), "Earnings Surprise");
});

test("signalOperandSummary describes each output shape", () => {
  const base: SignalOperand = { type: "signal", kind: "insider_cluster_buy", output: "days_since" };
  assert.equal(signalOperandSummary(base), "Days since Insider Cluster Buy");
  assert.equal(
    signalOperandSummary({ ...base, output: "count_in_window", window: 20 }),
    "Insider Cluster Buy count (20 bars)",
  );
  assert.equal(
    signalOperandSummary({ ...base, output: "last_score" }),
    "Insider Cluster Buy last score",
  );
});

test("signalOperandSummary appends the filter count", () => {
  const operand: SignalOperand = {
    type: "signal",
    kind: "insider_buy",
    output: "days_since",
    filters: { score: 0.5, dollar_value: 100000 },
  };
  assert.equal(signalOperandSummary(operand), "Days since Insider Buy (2 filters)");
  assert.equal(
    signalOperandSummary({ ...operand, filters: { score: 0.5 } }),
    "Days since Insider Buy (1 filter)",
  );
});
