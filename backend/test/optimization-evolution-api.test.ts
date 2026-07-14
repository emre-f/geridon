import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { resolveEvolutionConfig } from "../src/services/optimization/evolution.ts";
import { validateCaps } from "../src/services/optimization/evolutionGenome.ts";
import {
  experimentBody,
  insertCandles,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";
import { thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";
import type { Database } from "../src/db.ts";
import type { Strategy, StrategyRule } from "../src/types.ts";

function groupStrategy(): Strategy {
  return {
    name: "Grouped",
    entry: {
      type: "group",
      operator: "and",
      conditions: [thresholdRule("lt", 95), thresholdRule("gt", 80)],
    },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
}

function insert(db: Database, strategy: Strategy): number {
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  return Number(inserted.lastInsertRowid);
}

const libraryRule: StrategyRule = {
  type: "rule",
  left: { type: "price", field: "close" },
  operator: "lt",
  right: { type: "value", value: 93 },
};

test("evolution settings are validated with structured errors", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const bareId = insert(db, thresholdStrategy(95, 105));
  const groupedId = insert(db, groupStrategy());
  const runner = makeRunner(db);

  const cases: Array<{ body: Record<string, unknown>; detail: RegExp }> = [
    {
      body: experimentBody(bareId, { evolution: { ruleLibrary: [libraryRule] } }),
      detail: /method to be evolution/,
    },
    {
      body: experimentBody(bareId, { method: "evolution", evolution: { surprise: 1 } }),
      detail: /not a valid evolution setting/,
    },
    {
      body: experimentBody(bareId, {
        method: "evolution",
        evolution: { ruleLibrary: [{ ...libraryRule, left: { type: "indicator", kind: "nope" } }] },
      }),
      detail: /Unsupported indicator kind/,
    },
    {
      body: experimentBody(bareId, {
        method: "evolution",
        evolution: {
          ruleLibrary: [{ ...libraryRule, right: { type: "price", field: "close" } }],
        },
      }),
      detail: /compares an operand to itself/,
    },
    {
      body: experimentBody(bareId, {
        method: "evolution",
        evolution: { ruleLibrary: [libraryRule, structuredClone(libraryRule)] },
      }),
      detail: /duplicate of an earlier library rule/,
    },
    {
      body: experimentBody(bareId, {
        method: "evolution",
        evolution: { insertionPoints: ["entry.conditions.x"] },
      }),
      detail: /entries must look like/,
    },
    {
      body: experimentBody(bareId, {
        method: "evolution",
        evolution: { insertionPoints: ["entry"] },
      }),
      detail: /not an enabled and\/or group/,
    },
    {
      body: experimentBody(bareId, { method: "evolution", evolution: { maxTreeDepth: 9 } }),
      detail: /maxTreeDepth must be an integer between/,
    },
    {
      body: experimentBody(groupedId, {
        method: "evolution",
        parameter_overrides: {},
        evolution: { maxTreeDepth: 1 },
      }),
      detail: /baseline strategy already exceeds the evolution caps/,
    },
  ];

  for (const { body, detail } of cases) {
    const result = handleCreateExperiment(db, runner, body);
    assert.equal(result.statusCode, 400, JSON.stringify(body.evolution));
    assert.match((result.body as { detail: string }).detail, detail);
  }
});

test("an evolution experiment with an approved library runs to completion", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insert(db, groupStrategy());
  const runner = makeRunner(db);

  const experiment = await runToCompletion(
    db,
    runner,
    experimentBody(strategyId, {
      method: "evolution",
      max_trials: 16,
      parameter_overrides: {},
      evolution: {
        ruleLibrary: [libraryRule],
        insertionPoints: ["entry"],
        maxNewRulesPerSide: 1,
        maxActiveRulesPerSide: 4,
      },
    }),
  );

  assert.equal(experiment.status, "completed");
  assert.equal(experiment.config.method, "evolution");
  assert.deepEqual(experiment.config.evolution?.ruleLibrary, [libraryRule]);
  assert.deepEqual(experiment.config.evolution?.insertionPoints, ["entry"]);
  assert.ok(experiment.summary);
  assert.ok(experiment.summary.trial_counts.scored > 0);
});

test("preflight and creation reject the same invalid evolution config", async () => {
  const { handlePreflightExperiment } = await import("../src/api/optimizationPreflight.ts");
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insert(db, thresholdStrategy(95, 105));

  const body = experimentBody(strategyId, {
    method: "evolution",
    evolution: { insertionPoints: ["entry"] },
  });
  const preflight = handlePreflightExperiment(db, body);
  assert.equal(preflight.statusCode, 400);
  assert.match((preflight.body as { detail: string }).detail, /not an enabled and\/or group/);
});

test("caps default to the plan bounds but never exclude the baseline", () => {
  const grouped = groupStrategy();
  const resolved = resolveEvolutionConfig(undefined, grouped);
  assert.equal(resolved.maxTreeDepth, 3);
  assert.equal(resolved.maxNewRulesPerSide, 2);
  assert.equal(validateCaps(grouped, resolved), null);

  const explicit = resolveEvolutionConfig({ maxTreeDepth: 1 }, grouped);
  assert.match(validateCaps(grouped, explicit) ?? "", /tree depth 2 exceeds the cap of 1/);

  const deep: Strategy = {
    name: "Deep",
    entry: {
      type: "group",
      operator: "and",
      conditions: [
        {
          type: "group",
          operator: "or",
          conditions: [
            {
              type: "group",
              operator: "and",
              conditions: [thresholdRule("lt", 95), thresholdRule("gt", 80)],
            },
          ],
        },
      ],
    },
    exit: thresholdRule("gt", 105) as StrategyRule,
  };
  const raised = resolveEvolutionConfig(undefined, deep);
  assert.equal(raised.maxTreeDepth, 4);
  assert.equal(validateCaps(deep, raised), null);
});
