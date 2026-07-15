import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateOverlay } from "../src/services/metaLabeling/evaluation.ts";
import {
  evaluateGuardrails,
  guardrailThresholds,
} from "../src/services/metaLabeling/guardrails.ts";
import type { WalkForwardResult } from "../src/services/metaLabeling/walkForward.ts";
import { regimeDataset, thresholdStrategy } from "./optimizationFixtures.ts";

function walkForward(overrides: Partial<WalkForwardResult>): WalkForwardResult {
  const positive = overrides.positive_events ?? 150;
  const negative = overrides.negative_events ?? 150;
  const total = overrides.total_events ?? positive + negative;
  return {
    symbol: "TEST",
    feature_set_id: "meta-features-v1",
    fold_count: 4,
    label_embargo_candles: 3,
    training_sizes: [40, 80, 120, 160],
    validation_sizes: [40, 40, 40, 40],
    untrained_folds: [],
    total_events: total,
    positive_events: positive,
    negative_events: negative,
    open_trades: 0,
    fold_models: [],
    predictions: [],
    ...overrides,
  };
}

test("a balanced pool of hundreds of triggers passes every guardrail", () => {
  const report = evaluateGuardrails(walkForward({}));
  assert.equal(report.status, "ok");
  assert.deepEqual(report.findings, []);
  assert.equal(report.minority_fraction, 0.5);
});

test("a dozens-sized pool is refused for being too few triggers", () => {
  const report = evaluateGuardrails(
    walkForward({ positive_events: 15, negative_events: 15 }),
  );
  assert.equal(report.status, "refuse");
  const finding = report.findings.find((f) => f.code === "too_few_triggers");
  assert.equal(finding?.severity, "refuse");
});

test("fewer than the recommended hundreds only warns", () => {
  const report = evaluateGuardrails(
    walkForward({ positive_events: 60, negative_events: 60 }),
  );
  assert.equal(report.status, "warn");
  const finding = report.findings.find((f) => f.code === "too_few_triggers");
  assert.equal(finding?.severity, "warn");
  assert.ok(finding!.detail.total_events < guardrailThresholds.warnBelowTriggers);
});

test("extreme class imbalance is refused, moderate imbalance warns", () => {
  const refused = evaluateGuardrails(
    walkForward({ positive_events: 390, negative_events: 10, total_events: 400 }),
  );
  assert.equal(refused.status, "refuse");
  assert.equal(
    refused.findings.find((f) => f.code === "class_imbalance")?.severity,
    "refuse",
  );

  const warned = evaluateGuardrails(
    walkForward({ positive_events: 360, negative_events: 40, total_events: 400 }),
  );
  assert.equal(warned.status, "warn");
  assert.equal(
    warned.findings.find((f) => f.code === "class_imbalance")?.severity,
    "warn",
  );
});

test("near-empty validation folds warn, and untrained folds are reported separately", () => {
  const report = evaluateGuardrails(
    walkForward({
      validation_sizes: [40, 2, 40, 40],
      untrained_folds: [3],
    }),
  );
  assert.equal(report.status, "warn");
  const sparse = report.findings.filter((f) => f.code === "sparse_validation_fold");
  assert.equal(sparse.length, 1, "only fold 1 is sparse");
  assert.equal(sparse[0].detail.fold_index, 1);
  assert.equal(
    report.findings.filter((f) => f.code === "untrained_fold").length,
    1,
    "fold 3 is reported as untrained, not double-counted as sparse",
  );
});

test("an untrained sparse fold is not also flagged sparse", () => {
  const report = evaluateGuardrails(
    walkForward({ validation_sizes: [40, 40, 40, 1], untrained_folds: [3] }),
  );
  assert.equal(
    report.findings.filter((f) => f.code === "sparse_validation_fold").length,
    0,
    "the untrained finding subsumes the empty fold",
  );
});

test("evaluateOverlay attaches a guardrail report drawn from the real walk-forward pool", () => {
  const input = {
    symbol: "TEST" as const,
    positionMode: "long_only" as const,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    folds: { foldCount: 4, mode: "anchored" as const },
    strategy: thresholdStrategy(100, 101.9),
    candles: regimeDataset().candles,
    costs: { commission_per_trade: 0, commission_pct: 2, slippage_bps: 0 },
  };
  const result = evaluateOverlay(input, { seed: 42 });

  assert.equal(
    result.guardrails.total_events,
    result.walk_forward.total_events,
    "guardrails judge the whole trade-event pool the walk-forward built",
  );
  assert.ok(
    result.guardrails.total_events >= result.take_everything.trades_total,
    "the pool is at least the validation-window trades take-everything scores",
  );
  assert.equal(
    result.guardrails.positive_events + result.guardrails.negative_events,
    result.guardrails.total_events,
    "every labelled event is one class or the other",
  );
  assert.ok(["ok", "warn", "refuse"].includes(result.guardrails.status));
  assert.deepEqual(
    result.guardrails,
    evaluateOverlay(input, { seed: 42 }).guardrails,
    "guardrails are reproducible for a fixed seed",
  );
});
