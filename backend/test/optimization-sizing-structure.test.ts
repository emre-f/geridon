import assert from "node:assert/strict";
import { test } from "node:test";

import { handleGetSearchSpacePreview } from "../src/api/optimizationSearchSpace.ts";
import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { candidateHash, strategyHash } from "../src/services/optimization/canonical.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { applyValues } from "../src/services/optimization/sampler.ts";
import {
  compileSearchSpace,
  sizingFromValues,
  sizingNodeIds,
} from "../src/services/optimization/searchSpace.ts";
import type {
  NumericSearchNode,
  OperatorSearchNode,
  SearchSpacePreview,
  Strategy,
  StrategyGroup,
  StrategyRule,
} from "../src/types.ts";
import {
  experimentBody,
  insertCandles,
  insertStrategy,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";
import { baseConfig, thresholdRule, thresholdStrategy } from "./optimizationFixtures.ts";

function atLeastStrategy(): Strategy {
  return {
    name: "At least",
    entry: {
      type: "group",
      operator: "at_least",
      count: 2,
      conditions: [thresholdRule("lt", 95), thresholdRule("lt", 97), thresholdRule("gt", 80)],
    },
    exit: thresholdRule("gt", 105),
  };
}

test("sizing nodes exist only for long_only with an unlocked override", () => {
  const strategy = thresholdStrategy(95, 105);
  const base = { strategy, positionMode: "long_only" as const, buyPercent: 100, sellPercent: 100 };

  const none = compileSearchSpace(base);
  assert.ok(none.nodes.every((node) => node.path[0] !== "sizing"));

  const overridden = compileSearchSpace({
    ...base,
    parameterOverrides: { [sizingNodeIds.buyPercent]: { min: -20, max: 400, step: 10 } },
  });
  const sizingNode = overridden.nodes.find((node) => node.id === sizingNodeIds.buyPercent);
  assert.ok(sizingNode && sizingNode.kind === "numeric");
  assert.equal(sizingNode.min, 1, "range clamps to the simulator's hard minimum");
  assert.equal(sizingNode.max, 100, "range clamps to the simulator's hard maximum");
  assert.equal(sizingNode.path.join("."), "sizing.buyPercent");

  const locked = compileSearchSpace({
    ...base,
    parameterOverrides: { [sizingNodeIds.buyPercent]: { locked: true } },
  });
  assert.ok(locked.nodes.every((node) => node.path[0] !== "sizing"));

  const alwaysIn = compileSearchSpace({
    ...base,
    positionMode: "always_in",
    parameterOverrides: { [sizingNodeIds.buyPercent]: {} },
  });
  assert.ok(alwaysIn.nodes.every((node) => node.path[0] !== "sizing"));
});

test("sizing values stay off the strategy tree and distinguish candidate hashes", () => {
  const strategy = thresholdStrategy(95, 105);
  const { baseStrategy, nodes } = compileSearchSpace({
    strategy,
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    parameterOverrides: {
      "entry.right.value": { locked: true },
      "exit.right.value": { locked: true },
      [sizingNodeIds.buyPercent]: { min: 20, max: 100, step: 10 },
    },
  });

  const candidate = applyValues(baseStrategy, nodes, { [sizingNodeIds.buyPercent]: 40 });
  assert.deepEqual(candidate, baseStrategy, "sizing must not mutate the strategy tree");

  const sizing = sizingFromValues({ [sizingNodeIds.buyPercent]: 40 });
  assert.deepEqual(sizing, { buyPercent: 40 });
  assert.equal(sizingFromValues({ "entry.right.value": 95 }), undefined);

  assert.equal(candidateHash(candidate), strategyHash(candidate));
  assert.notEqual(candidateHash(candidate, { buyPercent: 40 }), candidateHash(candidate));
  assert.notEqual(
    candidateHash(candidate, { buyPercent: 40 }),
    candidateHash(candidate, { buyPercent: 60 }),
  );
});

test("an optimization over sizing scores sizing-only candidates and stays deterministic", () => {
  const config = () =>
    baseConfig(thresholdStrategy(95, 105), {
      maxTrials: 16,
      parameterOverrides: {
        "entry.right.value": { locked: true },
        "exit.right.value": { locked: true },
        [sizingNodeIds.buyPercent]: { min: 20, max: 100, step: 10 },
      },
    });

  const result = runOptimization(config());
  const scored = result.trials.filter((trial) => trial.status === "scored");
  assert.ok(scored.length > 0);
  for (const trial of scored) {
    const buyPercent = trial.values[sizingNodeIds.buyPercent];
    assert.equal(typeof buyPercent, "number");
    assert.deepEqual(trial.sizing, { buyPercent });
    assert.deepEqual(trial.strategy.entry, config().strategy.entry);
  }
  const distinctSizes = new Set(scored.map((trial) => trial.values[sizingNodeIds.buyPercent]));
  assert.ok(distinctSizes.size > 1, "the search should try more than one buy percent");
  const distinctScores = new Set(scored.map((trial) => trial.score!.score));
  assert.ok(distinctScores.size > 1, "different sizing must change evaluation results");

  assert.equal(JSON.stringify(runOptimization(config())), JSON.stringify(result));
});

test("operator search samples valid operators only for opted-in rules", () => {
  const strategy = thresholdStrategy(95, 105);
  const { baseStrategy, nodes } = compileSearchSpace({
    strategy,
    structure: { operators: ["entry", "missing.rule"] },
  });

  const operatorNodes = nodes.filter((node): node is OperatorSearchNode => node.kind === "operator");
  assert.equal(operatorNodes.length, 1);
  assert.equal(operatorNodes[0].id, "entry.operator");
  assert.equal(operatorNodes[0].current, "lt");
  assert.equal(operatorNodes[0].choices.length, 6);

  const candidate = applyValues(baseStrategy, nodes, { "entry.operator": "cross_below" });
  assert.equal((candidate.entry as StrategyRule).operator, "cross_below");
});

test("operator search is skipped for rules turned off by their role", () => {
  const { nodes } = compileSearchSpace({
    strategy: atLeastStrategy(),
    ruleRoles: { "entry.conditions.0": "off" },
    structure: { operators: ["entry.conditions.0", "entry.conditions.1"] },
  });
  const operatorIds = nodes.filter((node) => node.kind === "operator").map((node) => node.id);
  assert.deepEqual(operatorIds, ["entry.conditions.1.operator"]);
});

test("at_least count search compiles an integer node bounded by the group size", () => {
  const strategy = atLeastStrategy();
  const { baseStrategy, nodes } = compileSearchSpace({
    strategy,
    structure: { atLeast: ["entry"] },
  });

  const countNode = nodes.find((node) => node.id === "entry.count") as NumericSearchNode;
  assert.ok(countNode);
  assert.equal(countNode.kind, "numeric");
  assert.equal(countNode.valueType, "integer");
  assert.equal(countNode.min, 1);
  assert.equal(countNode.max, 3);
  assert.equal(countNode.current, 2);

  const candidate = applyValues(baseStrategy, nodes, { "entry.count": 1 });
  assert.equal((candidate.entry as StrategyGroup).count, 1);
});

test("an optimization over operators and at_least counts is valid and deterministic", () => {
  const config = () =>
    baseConfig(atLeastStrategy(), {
      maxTrials: 20,
      structure: { operators: ["exit"], atLeast: ["entry"] },
      parameterOverrides: {
        "entry.conditions.0.right.value": { locked: true },
        "entry.conditions.1.right.value": { locked: true },
        "entry.conditions.2.right.value": { locked: true },
        "exit.right.value": { locked: true },
      },
    });

  const result = runOptimization(config());
  assert.ok(result.trials.some((trial) => trial.status === "scored"));
  const operators = new Set<string>();
  const counts = new Set<number>();
  for (const trial of result.trials) {
    if (trial.status === "rejected") {
      continue;
    }
    const operator = (trial.strategy.exit as StrategyRule).operator;
    assert.equal(operator, trial.values["exit.operator"]);
    operators.add(operator);
    const count = (trial.strategy.entry as StrategyGroup).count!;
    assert.equal(count, trial.values["entry.count"]);
    assert.ok(count >= 1 && count <= 3);
    counts.add(count);
  }
  assert.ok(operators.size > 1, "the search should try more than one operator");
  assert.ok(counts.size > 1, "the search should try more than one at_least count");

  assert.equal(JSON.stringify(runOptimization(config())), JSON.stringify(result));
});

test("experiment API validates sizing overrides and structure search with structured errors", () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const cases: Array<Record<string, unknown>> = [
    { parameter_overrides: { "sizing.buyPercent": {} }, position_mode: "always_in" },
    { parameter_overrides: { "sizing.percent": {} } },
    { structure_search: { operators: "entry" } },
    { structure_search: { operators: ["entry", "entry"] } },
    { structure_search: { surprise: ["entry"] } },
    { structure_search: { operators: ["missing.rule"] } },
    { structure_search: { at_least: ["entry"] } },
  ];
  for (const overrides of cases) {
    const result = handleCreateExperiment(db, runner, experimentBody(strategyId, overrides));
    assert.equal(result.statusCode, 400, JSON.stringify(overrides));
  }
});

test("a sizing + operator experiment round-trips through the API and completes", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const strategyId = insertStrategy(db);
  const runner = makeRunner(db);

  const experiment = await runToCompletion(
    db,
    runner,
    experimentBody(strategyId, {
      structure_search: { operators: ["exit"] },
      parameter_overrides: {
        "entry.right.value": { choices: [90.5, 93, 95] },
        "exit.right.value": { locked: true },
        "sizing.buyPercent": { min: 40, max: 100, step: 20 },
      },
    }),
  );
  assert.equal(experiment.status, "completed");
  assert.deepEqual(experiment.config.structure_search, { operators: ["exit"] });
  assert.ok(experiment.summary!.space.some((node) => node.id === "sizing.buyPercent"));
  assert.ok(experiment.summary!.space.some((node) => node.kind === "operator"));

  const trials = db
    .prepare(
      `SELECT trial_values FROM optimization_trials
       WHERE experiment_id = ? AND status = 'scored'`,
    )
    .all(experiment.id) as Array<{ trial_values: string }>;
  assert.ok(trials.length > 0);
  for (const row of trials) {
    const values = JSON.parse(row.trial_values) as Record<string, unknown>;
    assert.equal(typeof values["sizing.buyPercent"], "number");
    assert.equal(typeof values["exit.operator"], "string");
  }
});

test("search-space preview reports sizing dimensions and at_least groups", () => {
  const db = makeDb();
  const strategy = atLeastStrategy();
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(strategy.name, JSON.stringify(strategy));
  const strategyId = Number(inserted.lastInsertRowid);

  const preview = (params: Record<string, string>) => {
    const result = handleGetSearchSpacePreview(
      db,
      new URLSearchParams({ strategy_id: String(strategyId), ...params }),
    );
    assert.equal(result.statusCode, 200);
    return result.body as SearchSpacePreview;
  };

  const longOnly = preview({ buy_percent: "80" });
  assert.deepEqual(
    longOnly.sizing_nodes.map((node) => [node.id, node.hard_min, node.hard_max]),
    [
      ["sizing.buyPercent", 1, 100],
      ["sizing.sellPercent", 1, 100],
    ],
  );
  assert.equal(
    (longOnly.sizing_nodes[0] as NumericSearchNode & { hard_min: number }).current,
    80,
  );
  assert.deepEqual(longOnly.at_least_groups, [{ id: "entry", size: 3, count: 2 }]);

  const alwaysIn = preview({ position_mode: "always_in" });
  assert.deepEqual(alwaysIn.sizing_nodes, []);

  const invalid = handleGetSearchSpacePreview(
    db,
    new URLSearchParams({ strategy_id: String(strategyId), buy_percent: "0" }),
  );
  assert.equal(invalid.statusCode, 400);
});
