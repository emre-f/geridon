import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { handleGetSearchSpacePreview } from "../src/api/optimizationSearchSpace.ts";
import type { OptimizationExperimentRecord, SearchSpacePreview, Strategy } from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
} from "./experimentTestHelpers.ts";

function insertMacdStrategy(db: ReturnType<typeof makeDb>): number {
  const macd = {
    type: "indicator",
    kind: "macd",
    parameters: { fast: 12, slow: 26, signal: 9 },
    output: "macd",
  } as const;
  const strategy: Strategy = {
    name: "MACD zero cross",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        { type: "rule", left: macd, operator: "cross_above", right: { type: "value", value: 0 } },
        {
          type: "rule",
          left: { type: "price", field: "close" },
          operator: "gt",
          right: { type: "value", value: 95 },
        },
      ],
    },
    exit: {
      type: "rule",
      left: macd,
      operator: "cross_below",
      right: { type: "value", value: 0 },
    },
  };
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  return Number(inserted.lastInsertRowid);
}

test("search-space preview lists rules and nodes with catalog bounds", () => {
  const db = makeDb();
  const strategyId = insertMacdStrategy(db);

  const result = handleGetSearchSpacePreview(db, String(strategyId));
  assert.equal(result.statusCode, 200);
  const preview = result.body as SearchSpacePreview;

  assert.deepEqual(
    preview.rules.map((rule) => [rule.id, rule.side, rule.enabled]),
    [
      ["entry.conditions.0", "entry", true],
      ["entry.conditions.1", "entry", true],
      ["exit", "exit", true],
    ],
  );
  assert.ok(preview.rules[0].summary.includes("cross_above"));

  const fastNode = preview.nodes.find((node) => node.id === "entry.conditions.0.left.parameters.fast");
  assert.ok(fastNode);
  assert.equal(fastNode.hard_min, 1);
  assert.equal(fastNode.hard_max, 500);

  const thresholdNode = preview.nodes.find((node) => node.id === "entry.conditions.1.right.value");
  assert.ok(thresholdNode);
  assert.equal(thresholdNode.hard_min, null);
  assert.equal(thresholdNode.hard_max, null);
});

test("search-space preview validates the strategy id", () => {
  const db = makeDb();
  assert.equal(handleGetSearchSpacePreview(db, "abc").statusCode, 400);
  assert.equal(handleGetSearchSpacePreview(db, null).statusCode, 400);
  assert.equal(handleGetSearchSpacePreview(db, "999").statusCode, 404);
});

test("invalid rule roles and parameter overrides return structured errors", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const cases: Array<Record<string, unknown>> = [
    { rule_roles: { entry: "banana" } },
    { rule_roles: "entry" },
    { parameter_overrides: { "entry.right.value": { min: 10, max: 5 } } },
    { parameter_overrides: { "entry.right.value": { step: 0 } } },
    { parameter_overrides: { "entry.right.value": { locked: "yes" } } },
    { parameter_overrides: { "entry.right.value": { choices: [] } } },
    { parameter_overrides: { "entry.right.value": { surprise: 1 } } },
  ];
  for (const overrides of cases) {
    const result = handleCreateExperiment(db, runner, experimentBody(strategyId, overrides));
    assert.equal(result.statusCode, 400, JSON.stringify(overrides));
  }
});

test("rule roles and custom ranges from the form round-trip into the config", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const created = handleCreateExperiment(
    db,
    runner,
    experimentBody(strategyId, {
      rule_roles: { entry: "required", exit: "optional" },
      parameter_overrides: {
        "entry.right.value": { min: 90, max: 99, step: 0.5 },
        "exit.right.value": { locked: true },
      },
    }),
  );
  assert.equal(created.statusCode, 201);
  const record = created.body as OptimizationExperimentRecord;
  assert.deepEqual(record.config.rule_roles, { entry: "required", exit: "optional" });
  assert.deepEqual(record.config.parameter_overrides, {
    "entry.right.value": { min: 90, max: 99, step: 0.5 },
    "exit.right.value": { locked: true },
  });
  await runner.waitForFinish(record.id);
});
