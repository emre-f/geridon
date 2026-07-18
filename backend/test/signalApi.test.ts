import assert from "node:assert/strict";
import test from "node:test";

import {
  handleCreateSignalEvaluation,
  handleGetSignalCoverage,
  handleGetSignalEvaluation,
  handleGetSignalJob,
  handleGetSignalRegistrySummary,
  handleListSignalEvaluations,
  handleListSignalJobs,
  handlePreviewSignalSelection,
  handleRunSignalHoldout,
} from "../src/api/signals.ts";
import { createDb, openDatabase, type Database } from "../src/db.ts";
import { insertEvents } from "../src/services/eventStore.ts";
import { SignalEvaluationRunner } from "../src/services/signalEval/evaluationRunner.ts";
import {
  getJob, insertJob, markJobStatus, type SignalJobRow,
} from "../src/services/signalEval/evaluationJobStore.ts";
import {
  getEvaluation, recordEvaluation, type SignalEvaluationRow,
} from "../src/services/signalEval/registry.ts";
import type { EventRecord } from "../src/types/events.ts";

const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2020, 0, 1);
const barMs = (index: number, startMs = firstBarMs) => startMs + index * dayMs;

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

function insertDailyBars(
  db: Database,
  ticker: string,
  count: number,
  options: { close?: number; startMs?: number } = {},
): void {
  const close = options.close ?? 10;
  const insert = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, ?, ?, ?, ?, 1000000)
  `);
  for (let index = 0; index < count; index += 1) {
    insert.run(ticker, barMs(index, options.startMs), close, close, close, close);
  }
}

function makeBuy(overrides: Partial<EventRecord<"insider_buy">> = {}): EventRecord<"insider_buy"> {
  return {
    source: "sec_form4",
    ticker: "AAA",
    event_kind: "insider_buy",
    event_ts_ms: barMs(48),
    available_ts_ms: barMs(50) + 1_000,
    score: 5,
    payload: {
      insider_name: "Jane Roe",
      is_officer: true,
      is_director: false,
      is_ten_percent_owner: false,
      shares: 1_000,
      price: 50,
      dollar_value: 50_000,
    },
    dedupe_key: `key-${Math.random()}`,
    ...overrides,
  };
}

function evaluationWorld(): Database {
  const db = makeDb();
  insertDailyBars(db, "AAA", 130);
  insertDailyBars(db, "SPY", 130);
  insertEvents(db, [
    makeBuy({ dedupe_key: "e1" }),
    makeBuy({ dedupe_key: "e2", event_ts_ms: barMs(58), available_ts_ms: barMs(60), score: 7 }),
  ]);
  return db;
}

test("coverage endpoint reports events per kind per year and ingestions", () => {
  const db = evaluationWorld();
  db.prepare(`
    INSERT INTO event_ingestions (source, start_ms, end_ms, status, inserted_rows)
    VALUES ('sec_form4', 0, 1, 'completed', 2)
  `).run();

  const result = handleGetSignalCoverage(db);
  assert.equal(result.statusCode, 200);
  const body = result.body as {
    coverage: Array<{ event_kind: string; year: number; events: number }>;
    ingestions: Array<{ source: string; status: string; inserted_rows: number }>;
  };
  assert.deepEqual(body.coverage, [{ event_kind: "insider_buy", year: 2020, events: 2 }]);
  assert.equal(body.ingestions.length, 1);
  assert.equal(body.ingestions[0].status, "completed");
});

test("preview returns selection stats without running a study", () => {
  const db = evaluationWorld();
  const result = handlePreviewSignalSelection(db, { kind: "insider_buy", min_score: 6 });
  assert.equal(result.statusCode, 200);
  const stats = (result.body as { stats: { candidates: number; selected: number } }).stats;
  assert.equal(stats.candidates, 2);
  assert.equal(stats.selected, 1);

  assert.equal(handlePreviewSignalSelection(db, { kind: "nope" }).statusCode, 400);
  assert.equal(handlePreviewSignalSelection(db, null).statusCode, 400);
});

test("evaluation request validation rejects bad inputs", () => {
  const db = evaluationWorld();
  const runner = new SignalEvaluationRunner(db);
  const bad = [
    { body: { kind: "nope" }, message: "kind" },
    { body: { kind: "insider_buy", seed: -1 }, message: "seed" },
    { body: { kind: "insider_buy", start_ms: 5, end_ms: 1 }, message: "start_ms" },
    { body: { kind: "insider_buy", costs: { unknown: 1 } }, message: "costs" },
    { body: { kind: "insider_buy", payload_filters: { shares: "x" } }, message: "payload_filters" },
    { body: { kind: "insider_buy", bootstrap_iterations: 0 }, message: "bootstrap_iterations" },
  ];
  for (const { body, message } of bad) {
    const result = handleCreateSignalEvaluation(db, runner, body);
    assert.equal(result.statusCode, 400, message);
    assert.match(String((result.body as { detail: string }).detail), new RegExp(message));
  }
});

test("evaluation job runs to completion and lands in the registry", async () => {
  const db = evaluationWorld();
  const runner = new SignalEvaluationRunner(db, { workerCount: 1 });

  const created = handleCreateSignalEvaluation(db, runner, {
    kind: "insider_buy",
    seed: 7,
    bootstrap_iterations: 10,
  });
  assert.equal(created.statusCode, 201);
  const job = created.body as SignalJobRow;
  assert.equal(job.job_type, "evaluation");
  await runner.waitForFinish(job.id);

  const finished = getJob(db, job.id);
  assert.equal(finished?.status, "completed");
  assert.equal(finished?.selection_stats?.selected, 2);
  assert.ok(finished?.evaluation_id != null);

  const evaluation = getEvaluation(db, finished!.evaluation_id as number)!;
  assert.equal(evaluation.event_kind, "insider_buy");
  assert.equal(evaluation.seed, 7);
  assert.equal(evaluation.headline.n_events, 2);
  assert.equal(evaluation.verdict, "no_signal");
  assert.equal(evaluation.versions.signal_eval_version, 1);
  const detail = evaluation.detail as {
    study: { curve: unknown[] };
    cost_line: { round_trip_cost: number };
  };
  assert.equal(detail.study.curve.length, 63);
  assert.equal(detail.cost_line.round_trip_cost, 0.001);

  const fetched = handleGetSignalEvaluation(db, String(evaluation.id));
  assert.equal(fetched.statusCode, 200);

  const listed = handleListSignalEvaluations(db, new URLSearchParams());
  const items = (listed.body as { evaluations: Array<Record<string, unknown>> }).evaluations;
  assert.equal(items.length, 1);
  assert.equal("detail" in items[0], false);

  const summary = handleGetSignalRegistrySummary(db);
  assert.equal((summary.body as { total_draws: number }).total_draws, 1);

  const jobs = handleListSignalJobs(db, new URLSearchParams());
  assert.equal((jobs.body as { jobs: unknown[] }).jobs.length, 1);
  assert.equal(handleGetSignalJob(db, String(job.id)).statusCode, 200);
  assert.equal(handleGetSignalJob(db, "999").statusCode, 404);
});

function candidateEvaluation(db: Database): SignalEvaluationRow {
  return recordEvaluation(db, {
    query: { kind: "insider_buy" },
    seed: 3,
    headline: { baseline_gap_t_stat: 4, net_abnormal_return: 0.004, n_events: 900 },
    detail: {},
  });
}

test("holdout endpoint reruns the query on the sealed window exactly once", async () => {
  const db = makeDb();
  const holdoutBarsStart = Date.UTC(2024, 10, 1);
  insertDailyBars(db, "AAA", 200, { startMs: holdoutBarsStart });
  insertDailyBars(db, "SPY", 200, { startMs: holdoutBarsStart });
  insertEvents(db, [
    makeBuy({
      dedupe_key: "pre",
      event_ts_ms: Date.UTC(2024, 10, 20),
      available_ts_ms: Date.UTC(2024, 10, 22),
    }),
    makeBuy({
      dedupe_key: "post",
      event_ts_ms: Date.UTC(2025, 0, 8),
      available_ts_ms: Date.UTC(2025, 0, 10),
    }),
  ]);
  const runner = new SignalEvaluationRunner(db, { workerCount: 1 });
  const evaluation = candidateEvaluation(db);

  const accepted = handleRunSignalHoldout(db, runner, String(evaluation.id), {
    bootstrap_iterations: 10,
  });
  assert.equal(accepted.statusCode, 202);
  const job = accepted.body as SignalJobRow;
  await runner.waitForFinish(job.id);

  assert.equal(getJob(db, job.id)?.status, "completed");
  const consumed = getEvaluation(db, evaluation.id)!;
  assert.ok(consumed.holdout_consumed_at != null);
  const holdout = consumed.holdout_results as { headline: { n_events: number } };
  assert.equal(holdout.headline.n_events, 1);

  assert.equal(handleRunSignalHoldout(db, runner, String(evaluation.id), {}).statusCode, 409);
});

test("holdout endpoint rejects non-candidate and missing evaluations", () => {
  const db = makeDb();
  insertDailyBars(db, "AAA", 100);
  insertEvents(db, [makeBuy({ dedupe_key: "weakling" })]);
  const runner = new SignalEvaluationRunner(db);
  const weak = recordEvaluation(db, {
    query: { kind: "insider_buy" },
    seed: 1,
    headline: { baseline_gap_t_stat: 1, net_abnormal_return: 0, n_events: 10 },
    detail: {},
  });

  assert.equal(handleRunSignalHoldout(db, runner, String(weak.id), {}).statusCode, 409);
  assert.equal(handleRunSignalHoldout(db, runner, "999", {}).statusCode, 404);
  assert.equal(handleRunSignalHoldout(db, runner, "zero", {}).statusCode, 400);
});

test("boot recovery marks running jobs interrupted", () => {
  const db = evaluationWorld();
  const job = insertJob(db, "evaluation", { query: { kind: "insider_buy" }, seed: 1, costs: { commission_per_trade: 0, commission_pct: 0, slippage_bps: 0 } });
  markJobStatus(db, job.id, "running");

  const runner = new SignalEvaluationRunner(db);
  runner.recoverOnBoot();
  assert.equal(getJob(db, job.id)?.status, "interrupted");
});
