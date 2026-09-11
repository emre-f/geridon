import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { computeForwardReturns, type CloseBar } from "../src/services/forwardReturns.ts";
import {
  computeAndStoreForwardReturns,
  getForwardReturns,
} from "../src/services/forwardReturnStore.ts";
import { deriveInsiderClusterBuys } from "../src/services/sec/form4Clusters.ts";
import { ingestForm4, type Form4QuarterSummary } from "../src/services/sec/form4Ingest.ts";
import {
  defaultMarketTicker,
  evaluateEventSignal,
  type SignalEvaluationPackage,
} from "../src/services/signalEval/evaluate.ts";

/**
 * Cache correctness (plan §8): an evaluation must be byte-identical whether
 * the stores feeding it were cold (built fresh from source) or warm (re-run
 * over already-populated stores). Warm differs from cold in ways that must
 * not leak into results: `event_ingestions` skips completed quarters, and
 * cluster re-derivation deletes + rebuilds its rows with new ids and a new
 * insertion order. The forward_returns label cache must likewise read back
 * exactly what was computed.
 */

const fixturesDir = fileURLToPath(new URL("./fixtures/sec", import.meta.url));
const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2023, 10, 1);
const barCount = 300;
const worldTickers = ["FMBH", "TOL", defaultMarketTicker] as const;

const barMs = (index: number) => firstBarMs + index * dayMs;

function closeFor(ticker: string, index: number): number {
  if (ticker === defaultMarketTicker) {
    return 400 * (1 + 0.0003 * index + 0.005 * Math.sin(index * 0.11));
  }
  const base = ticker === "FMBH" ? 48 : 82;
  return base * (1 + 0.0002 * index + 0.01 * Math.sin(index * 0.7 + base));
}

function barsFor(ticker: string): CloseBar[] {
  return Array.from({ length: barCount }, (_, index) => ({
    timestamp_ms: barMs(index),
    close: closeFor(ticker, index),
  }));
}

function ingestFixtureQuarter(db: Database): Promise<Form4QuarterSummary[]> {
  return ingestForm4({
    db,
    fromYear: 2024,
    toYear: 2024,
    userAgent: "geridon test",
    cacheDir: fixturesDir,
    nowMs: Date.UTC(2024, 3, 15),
  });
}

async function buildColdWorld(): Promise<Database> {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insert = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  for (const ticker of worldTickers) {
    for (let index = 0; index < barCount; index += 1) {
      const close = closeFor(ticker, index);
      insert.run(ticker, barMs(index), close, close, close, close, 1_000_000);
    }
  }
  db.exec("COMMIT");

  const summaries = await ingestFixtureQuarter(db);
  assert.equal(summaries[0]?.status, "completed");
  assert.equal(summaries[0]?.inserted, 5);
  const derived = deriveInsiderClusterBuys(db);
  assert.equal(derived.clusters_inserted, 1);
  return db;
}

interface EvaluatedWorld {
  json: string;
  buys: SignalEvaluationPackage;
  clusters: SignalEvaluationPackage;
}

async function evaluateWorld(db: Database): Promise<EvaluatedWorld> {
  const buys = await evaluateEventSignal(db, {
    query: {
      kind: "insider_buy",
      universe: { minPrice: 5, minMedianDollarVolume: 5_000_000 },
    },
    seed: 7,
  });
  const clusters = await evaluateEventSignal(db, {
    query: { kind: "insider_cluster_buy" },
    seed: 7,
  });
  return { json: JSON.stringify({ buys, clusters }), buys, clusters };
}

test("warm re-ingestion and cluster rebuild leave evaluation byte-identical", async () => {
  const db = await buildColdWorld();
  const cold = await evaluateWorld(db);
  assert.ok(cold.buys.study.n_events >= 3);
  assert.equal(cold.clusters.study.n_events, 1);

  const rerun = await ingestFixtureQuarter(db);
  assert.equal(rerun[0]?.status, "already_ingested");
  assert.equal(rerun[0]?.inserted, 0);
  const rederived = deriveInsiderClusterBuys(db);
  assert.equal(rederived.previous_clusters_removed, 1);
  assert.equal(rederived.clusters_inserted, 1);

  const warm = await evaluateWorld(db);
  assert.equal(cold.json, warm.json);
});

test("an independently built cold world evaluates byte-identical", async () => {
  const first = await evaluateWorld(await buildColdWorld());
  const second = await evaluateWorld(await buildColdWorld());
  assert.equal(first.json, second.json);
});

test("forward-returns store reads back exactly what was computed", () => {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const bars = barsFor("FMBH");
  const marketBars = barsFor(defaultMarketTicker);

  const computed = computeForwardReturns({ bars, marketBars });
  computeAndStoreForwardReturns(db, { ticker: "FMBH", bars, marketBars });
  const firstRead = getForwardReturns(db, { ticker: "FMBH" });
  assert.equal(JSON.stringify(firstRead), JSON.stringify(computed));

  computeAndStoreForwardReturns(db, { ticker: "FMBH", bars, marketBars });
  const secondRead = getForwardReturns(db, { ticker: "FMBH" });
  assert.equal(JSON.stringify(secondRead), JSON.stringify(firstRead));
});
