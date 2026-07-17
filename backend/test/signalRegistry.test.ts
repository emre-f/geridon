import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { labelVersion } from "../src/services/forwardReturns.ts";
import {
  computeVerdict,
  consumeHoldout,
  eventQueryHash,
  getEvaluation,
  listEvaluations,
  recordEvaluation,
  type SignalHeadlineStats,
} from "../src/services/signalEval/registry.ts";
import { getRegistrySummary } from "../src/services/signalEval/registrySummary.ts";

function makeDb(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  return db;
}

const candidateHeadline: SignalHeadlineStats = {
  baseline_gap_t_stat: 3.4,
  net_abnormal_return: 0.002,
  n_events: 1_200,
};

function record(
  db: Database,
  overrides: {
    kind?: "insider_buy" | "insider_cluster_buy";
    headline?: Partial<SignalHeadlineStats>;
    seed?: number;
    minScore?: number;
  } = {},
) {
  return recordEvaluation(db, {
    query: {
      kind: overrides.kind ?? "insider_cluster_buy",
      minScore: overrides.minScore,
      startMs: 1_000,
      endMs: 2_000,
    },
    seed: overrides.seed ?? 42,
    headline: { ...candidateHeadline, ...overrides.headline },
    detail: { horizon_curve: [0.001, 0.002] },
  });
}

test("computeVerdict tiers on t-stat, net-of-cost return, and event count", () => {
  assert.equal(computeVerdict(candidateHeadline), "candidate");
  assert.equal(
    computeVerdict({ baseline_gap_t_stat: 2.2, net_abnormal_return: 0.0005, n_events: 300 }),
    "weak",
  );
  assert.equal(
    computeVerdict({ baseline_gap_t_stat: 1.9, net_abnormal_return: 0.005, n_events: 5_000 }),
    "no_signal",
  );
  assert.equal(
    computeVerdict({ baseline_gap_t_stat: 4, net_abnormal_return: -0.001, n_events: 5_000 }),
    "no_signal",
  );
  assert.equal(
    computeVerdict({ baseline_gap_t_stat: 4, net_abnormal_return: 0.002, n_events: 80 }),
    "no_signal",
  );
  assert.equal(
    computeVerdict({ baseline_gap_t_stat: 3.5, net_abnormal_return: 0.002, n_events: 400 }),
    "weak",
  );
});

test("recordEvaluation stores the full package and reads back losslessly", () => {
  const db = makeDb();
  const recorded = record(db, { minScore: 5 });

  const fetched = getEvaluation(db, recorded.id);
  assert.ok(fetched);
  assert.equal(fetched.event_kind, "insider_cluster_buy");
  assert.deepEqual(fetched.query, {
    kind: "insider_cluster_buy",
    minScore: 5,
    startMs: 1_000,
    endMs: 2_000,
  });
  assert.equal(fetched.start_ms, 1_000);
  assert.equal(fetched.end_ms, 2_000);
  assert.equal(fetched.seed, 42);
  assert.equal(fetched.versions.label_version, labelVersion);
  assert.deepEqual(fetched.headline, candidateHeadline);
  assert.deepEqual(fetched.detail, { horizon_curve: [0.001, 0.002] });
  assert.equal(fetched.verdict, "candidate");
  assert.equal(fetched.holdout_consumed_at, null);
  assert.equal(fetched.holdout_results, null);
});

test("eventQueryHash is key-order independent and query-sensitive", () => {
  const hash = eventQueryHash({ kind: "insider_buy", minScore: 5, startMs: 1 });
  assert.equal(hash, eventQueryHash({ startMs: 1, kind: "insider_buy", minScore: 5 }));
  assert.notEqual(hash, eventQueryHash({ kind: "insider_buy", minScore: 6, startMs: 1 }));
});

test("listEvaluations filters by kind and returns newest first", () => {
  const db = makeDb();
  const first = record(db, { kind: "insider_buy" });
  const second = record(db, { kind: "insider_cluster_buy" });
  const third = record(db, { kind: "insider_buy" });

  assert.deepEqual(
    listEvaluations(db).map((row) => row.id),
    [third.id, second.id, first.id],
  );
  assert.deepEqual(
    listEvaluations(db, { kind: "insider_buy" }).map((row) => row.id),
    [third.id, first.id],
  );
});

test("holdout is consumable exactly once, and only on a candidate", () => {
  const db = makeDb();
  const candidate = record(db);
  const weak = record(db, {
    headline: { baseline_gap_t_stat: 2.2, net_abnormal_return: 0.0005, n_events: 300 },
  });

  const consumed = consumeHoldout(db, candidate.id, { holdout_t_stat: 1.1 });
  assert.ok(consumed.holdout_consumed_at);
  assert.deepEqual(consumed.holdout_results, { holdout_t_stat: 1.1 });

  assert.throws(() => consumeHoldout(db, candidate.id, {}), /already consumed/);
  assert.throws(() => consumeHoldout(db, weak.id, {}), /only consumable on a candidate/);
  assert.throws(() => consumeHoldout(db, 9_999, {}), /not found/);
});

test("registry summary groups by kind and counts every draw", () => {
  const db = makeDb();
  record(db, { kind: "insider_buy", headline: { baseline_gap_t_stat: 1, n_events: 50 } });
  record(db, { kind: "insider_buy", headline: { baseline_gap_t_stat: 3 } });
  record(db, { kind: "insider_buy", headline: { baseline_gap_t_stat: 5 } });
  const clusterCandidate = record(db, { kind: "insider_cluster_buy" });
  consumeHoldout(db, clusterCandidate.id, { holdout_t_stat: 0.4 });

  const summary = getRegistrySummary(db);
  assert.equal(summary.total_draws, 4);
  assert.equal(summary.expected_lucky, 0.2);
  assert.deepEqual(
    summary.kinds.map((kind) => kind.event_kind),
    ["insider_buy", "insider_cluster_buy"],
  );

  const insiderBuy = summary.kinds[0];
  assert.equal(insiderBuy.evaluations, 3);
  assert.deepEqual(insiderBuy.verdicts, { no_signal: 1, weak: 0, candidate: 2 });
  assert.equal(insiderBuy.best_t_stat, 5);
  assert.equal(insiderBuy.median_t_stat, 3);
  assert.equal(insiderBuy.best_net_abnormal_return, 0.002);
  assert.equal(insiderBuy.holdouts_consumed, 0);

  const cluster = summary.kinds[1];
  assert.equal(cluster.evaluations, 1);
  assert.equal(cluster.holdouts_consumed, 1);
});

test("empty registry summarizes to zero draws", () => {
  const summary = getRegistrySummary(makeDb());
  assert.equal(summary.total_draws, 0);
  assert.equal(summary.expected_lucky, 0);
  assert.deepEqual(summary.kinds, []);
});
