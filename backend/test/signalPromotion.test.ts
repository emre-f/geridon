import assert from "node:assert/strict";
import test from "node:test";

import { handlePromoteSignalEvaluation } from "../src/api/signals.ts";
import { handleListStrategies } from "../src/api/strategies.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import type { EventSelectionOptions } from "../src/services/signalEval/eventSelection.ts";
import {
  recordEvaluation,
  type SignalEvaluationRow,
} from "../src/services/signalEval/registry.ts";
import type { StrategyRecord } from "../src/types.ts";

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

const candidateHeadline = { baseline_gap_t_stat: 4, net_abnormal_return: 0.004, n_events: 900 };

function candidateEvaluation(
  db: Database,
  overrides: { detail?: unknown; query?: EventSelectionOptions } = {},
): SignalEvaluationRow {
  return recordEvaluation(db, {
    query: overrides.query ?? {
      kind: "insider_cluster_buy",
      minScore: 5,
      payloadFilters: { combined_value: 100_000 },
    },
    seed: 3,
    headline: candidateHeadline,
    detail: overrides.detail ?? {
      horizon_summary: { rows: [], natural_holding_period_bars: 21, peak_gap: 0.01 },
    },
  });
}

const expectedOperand = {
  type: "signal",
  kind: "insider_cluster_buy",
  output: "days_since",
  filters: { combined_value: 100_000, score: 5 },
};

test("promoting a candidate saves the starter strategy", () => {
  const db = makeDb();
  const evaluation = candidateEvaluation(db);

  const result = handlePromoteSignalEvaluation(db, String(evaluation.id), null);
  assert.equal(result.statusCode, 201);
  const body = result.body as { evaluation_id: number; strategy: StrategyRecord };
  assert.equal(body.evaluation_id, evaluation.id);
  assert.equal(body.strategy.name, `Insider Cluster Buy starter (eval ${evaluation.id})`);
  assert.deepEqual(body.strategy.entry, {
    type: "rule",
    left: expectedOperand,
    operator: "lte",
    right: { type: "value", value: 1 },
  });
  assert.deepEqual(body.strategy.exit, {
    type: "rule",
    left: expectedOperand,
    operator: "gte",
    right: { type: "value", value: 21 },
  });

  const listed = handleListStrategies(db).body as StrategyRecord[];
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, body.strategy.id);
});

test("trend_filter wraps the trigger in an AND group with close above SMA(200)", () => {
  const db = makeDb();
  const evaluation = candidateEvaluation(db);

  const result = handlePromoteSignalEvaluation(db, String(evaluation.id), {
    name: "My promoted signal",
    trend_filter: true,
  });
  assert.equal(result.statusCode, 201);
  const strategy = (result.body as { strategy: StrategyRecord }).strategy;
  assert.equal(strategy.name, "My promoted signal");
  assert.deepEqual(strategy.entry, {
    type: "group",
    operator: "and",
    conditions: [
      {
        type: "rule",
        left: expectedOperand,
        operator: "lte",
        right: { type: "value", value: 1 },
      },
      {
        type: "rule",
        left: { type: "price", field: "close" },
        operator: "gt",
        right: { type: "indicator", kind: "sma", parameters: { period: 200 }, output: "sma" },
      },
    ],
  });
});

test("a query without filters promotes to a filterless operand", () => {
  const db = makeDb();
  const evaluation = candidateEvaluation(db, { query: { kind: "insider_buy" } });

  const result = handlePromoteSignalEvaluation(db, String(evaluation.id), null);
  assert.equal(result.statusCode, 201);
  const strategy = (result.body as { strategy: StrategyRecord }).strategy;
  assert.equal(strategy.name, `Insider Buy starter (eval ${evaluation.id})`);
  assert.deepEqual(strategy.entry, {
    type: "rule",
    left: { type: "signal", kind: "insider_buy", output: "days_since" },
    operator: "lte",
    right: { type: "value", value: 1 },
  });
});

test("promotion requires a candidate verdict", () => {
  const db = makeDb();
  const weak = recordEvaluation(db, {
    query: { kind: "insider_buy" },
    seed: 1,
    headline: { baseline_gap_t_stat: 1, net_abnormal_return: 0, n_events: 10 },
    detail: { horizon_summary: { rows: [], natural_holding_period_bars: 21, peak_gap: 0.01 } },
  });

  const result = handlePromoteSignalEvaluation(db, String(weak.id), null);
  assert.equal(result.statusCode, 409);
  assert.match(String((result.body as { detail: string }).detail), /candidate/);
});

test("promotion without a natural holding period is rejected", () => {
  const db = makeDb();
  const evaluation = candidateEvaluation(db, {
    detail: { horizon_summary: { rows: [], natural_holding_period_bars: null, peak_gap: -0.01 } },
  });

  const result = handlePromoteSignalEvaluation(db, String(evaluation.id), null);
  assert.equal(result.statusCode, 409);
  assert.match(String((result.body as { detail: string }).detail), /natural holding period/);

  const legacy = candidateEvaluation(db, { detail: {} });
  assert.equal(handlePromoteSignalEvaluation(db, String(legacy.id), null).statusCode, 409);
});

test("promotion rejects bad ids and bad bodies", () => {
  const db = makeDb();
  const evaluation = candidateEvaluation(db);

  assert.equal(handlePromoteSignalEvaluation(db, "999", null).statusCode, 404);
  assert.equal(handlePromoteSignalEvaluation(db, "zero", null).statusCode, 400);
  assert.equal(
    handlePromoteSignalEvaluation(db, String(evaluation.id), { name: "  " }).statusCode,
    400,
  );
  assert.equal(
    handlePromoteSignalEvaluation(db, String(evaluation.id), { trend_filter: "yes" }).statusCode,
    400,
  );
  assert.equal(handlePromoteSignalEvaluation(db, String(evaluation.id), []).statusCode, 400);
});
