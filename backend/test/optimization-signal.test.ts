import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCreateExperiment } from "../src/api/optimizationExperiments.ts";
import { insertEvents } from "../src/services/eventStore.ts";
import { searchDatasets } from "../src/services/optimization/holdout.ts";
import { runOptimization } from "../src/services/optimization/optimizer.ts";
import { applyValues } from "../src/services/optimization/sampler.ts";
import { compileSearchSpace, validateCandidate } from "../src/services/optimization/searchSpace.ts";
import {
  experimentBody,
  insertCandles,
  makeDb,
  makeRunner,
  runToCompletion,
} from "./experimentTestHelpers.ts";
import { baseConfig, dataset, triangleCandles } from "./optimizationFixtures.ts";
import type { EventRecord } from "../src/types/events.ts";
import type { SignalOperand, Strategy } from "../src/types.ts";

function clusterEvent(id: number, availableTsMs: number): EventRecord {
  return {
    source: "sec_form4",
    ticker: "TEST",
    event_kind: "insider_cluster_buy",
    event_ts_ms: availableTsMs,
    available_ts_ms: availableTsMs,
    score: 5,
    payload: {
      insider_count: 2,
      insider_names: ["Jane Doe", "John Roe"],
      window_days: 10,
      combined_dollar_value: 100_000,
    },
    dedupe_key: `cluster-${id}`,
  };
}

function eventsEveryThirtyBars(count: number): EventRecord[] {
  const candles = triangleCandles(count);
  const events: EventRecord[] = [];
  for (let index = 2; index < count; index += 30) {
    events.push(clusterEvent(index, candles[index].timestamp_ms));
  }
  return events;
}

const signalStrategy: Strategy = {
  name: "Cluster harness",
  entry: {
    type: "rule",
    left: {
      type: "signal",
      kind: "insider_cluster_buy",
      output: "count_in_window",
      window: 5,
      filters: { score: 4 },
    },
    operator: "gte",
    right: { type: "value", value: 1 },
  },
  exit: {
    type: "rule",
    left: { type: "signal", kind: "insider_cluster_buy", output: "days_since" },
    operator: "gte",
    right: { type: "value", value: 10 },
  },
};

test("signal operands compile to window and filter nodes; kind and output stay locked", () => {
  const { nodes } = compileSearchSpace({ strategy: signalStrategy });
  const window = nodes.find((node) => node.id === "entry.left.window");
  assert.ok(window && window.kind === "numeric");
  assert.equal(window.valueType, "integer");
  assert.ok(window.min >= 1 && window.min <= 5 && window.max >= 5);
  const score = nodes.find((node) => node.id === "entry.left.filters.score");
  assert.ok(score && score.kind === "numeric");
  assert.ok(score.min < 5 && score.max > 4);
  assert.ok(nodes.every((node) => !node.path.includes("kind") && !node.path.includes("output")));

  const locked = compileSearchSpace({
    strategy: signalStrategy,
    parameterOverrides: { "entry.left.window": { locked: true } },
  });
  assert.equal(locked.nodes.find((node) => node.id === "entry.left.window"), undefined);
});

test("applyValues materializes sampled window and filter values", () => {
  const { baseStrategy, nodes } = compileSearchSpace({ strategy: signalStrategy });
  const candidate = applyValues(baseStrategy, nodes, {
    "entry.left.window": 8,
    "entry.left.filters.score": 4.5,
  });
  const entry = candidate.entry;
  assert.ok(entry.type === "rule");
  const operand = entry.left as SignalOperand;
  assert.equal(operand.window, 8);
  assert.equal(operand.filters?.score, 4.5);
  assert.equal(operand.kind, "insider_cluster_buy");
  assert.equal(operand.output, "count_in_window");
});

test("validateCandidate rejects signal windows and filters outside bounds", () => {
  assert.equal(validateCandidate(signalStrategy, "long_only"), null);

  const zeroWindow = structuredClone(signalStrategy);
  ((zeroWindow.entry as { left: SignalOperand }).left).window = 0;
  assert.match(validateCandidate(zeroWindow, "long_only") ?? "", /window: must be an integer/);

  const badFilter = structuredClone(signalStrategy);
  ((badFilter.entry as { left: SignalOperand }).left).filters = { score: Number.NaN };
  assert.match(validateCandidate(badFilter, "long_only") ?? "", /filters\.score/);
});

test("searchDatasets seals events that became available in the holdout window", () => {
  const full = dataset(100);
  const inSearch = clusterEvent(1, full.candles[50].timestamp_ms);
  const inHoldout = clusterEvent(2, full.candles[90].timestamp_ms);
  full.events = [inSearch, inHoldout];

  const [search] = searchDatasets([full], { fraction: 0.2 });
  assert.equal(search.candles.length, 80);
  assert.deepEqual(search.events?.map((event) => event.dedupe_key), ["cluster-1"]);
  assert.equal(full.events.length, 2);
});

test("the optimizer evaluates signal strategies against the dataset's events", async () => {
  const withEvents = { ...dataset(400), events: eventsEveryThirtyBars(400) };
  const config = baseConfig(signalStrategy, {
    datasets: [withEvents],
    maxTrials: 8,
    refinement: { enabled: false },
  });
  const result = await runOptimization(config);

  assert.ok(result.space.some((node) => node.id === "entry.left.window"));
  assert.ok(result.trials.some((trial) => trial.status === "scored"));
  const baselineTrades = result.baseline.foldResults.reduce(
    (sum, fold) => sum + fold.trade_count,
    0,
  );
  assert.ok(baselineTrades > 0);
});

test("experiment creation fails loudly when no ticker has events for the signal kinds", async () => {
  const db = makeDb();
  insertCandles(db, "TEST", 400);
  const inserted = db
    .prepare("INSERT INTO strategies (name, definition) VALUES (?, ?)")
    .run(signalStrategy.name, JSON.stringify(signalStrategy));
  const strategyId = Number(inserted.lastInsertRowid);
  const runner = makeRunner(db);
  const body = experimentBody(strategyId, { max_trials: 4, parameter_overrides: {} });

  const rejected = handleCreateExperiment(db, runner, body);
  assert.equal(rejected.statusCode, 400);
  assert.match(
    String((rejected.body as { detail?: string }).detail),
    /No stored insider_cluster_buy events/,
  );

  insertEvents(db, eventsEveryThirtyBars(400));
  const record = await runToCompletion(db, runner, body);
  assert.equal(record.status, "completed");
  assert.ok((record.summary?.trial_counts.scored ?? 0) > 0);
});
