import assert from "node:assert/strict";
import test from "node:test";

import { createDb, openDatabase, type Database } from "../src/db.ts";
import { insertEvents } from "../src/services/eventStore.ts";
import {
  defaultMarketTicker,
  evaluateEventSignal,
  type EvaluateSignalOptions,
} from "../src/services/signalEval/evaluate.ts";
import { blockGapTStats } from "../src/services/signalEval/eventStudyStats.ts";
import type { EventRecord } from "../src/types/events.ts";

const dayMs = 86_400_000;
const firstBarMs = Date.UTC(2020, 0, 1);
const barMs = (index: number) => firstBarMs + index * dayMs;

function makeDbWithBars(): Database {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);
  const insert = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?)
  `);
  const tickers = ["AAA", "BBB", "CCC", defaultMarketTicker];
  tickers.forEach((ticker, offset) => {
    for (let index = 0; index < 160; index += 1) {
      const close =
        ticker === defaultMarketTicker
          ? 300 + index * 0.05 + Math.sin(index) * 1
          : 10 + offset + Math.sin(index * 0.7 + offset) * 1.5 + index * 0.01;
      insert.run(ticker, barMs(index), close, close, close, close, 1_000_000);
    }
  });
  return db;
}

function makeBuys(): EventRecord<"insider_buy">[] {
  const tickers = ["AAA", "BBB", "CCC"] as const;
  return Array.from({ length: 15 }, (_, index) => {
    const shares = 500 + index * 100;
    const price = 10 + index;
    return {
      source: "sec_form4" as const,
      ticker: tickers[index % tickers.length],
      event_kind: "insider_buy" as const,
      event_ts_ms: barMs(4 + index * 6),
      available_ts_ms: barMs(5 + index * 6) + 1_000,
      score: 3 + (index % 5) * 0.7,
      payload: {
        insider_name: `Insider ${index}`,
        is_officer: index % 2 === 0,
        is_director: index % 3 === 0,
        is_ten_percent_owner: false,
        shares,
        price,
        dollar_value: shares * price,
      },
      dedupe_key: `buy-${index}`,
    };
  });
}

const baseOptions: EvaluateSignalOptions = {
  query: { kind: "insider_buy" },
  seed: 42,
};

test("same inputs and seed produce byte-identical output JSON", async () => {
  const db = makeDbWithBars();
  insertEvents(db, makeBuys());

  const first = await evaluateEventSignal(db, baseOptions);
  const second = await evaluateEventSignal(db, baseOptions);

  assert.equal(first.study.n_events, 15);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("worker pool output is byte-identical to the inline path", async () => {
  const db = makeDbWithBars();
  insertEvents(db, makeBuys());

  const inline = await evaluateEventSignal(db, { ...baseOptions, workerCount: 1 });
  const pooled = await evaluateEventSignal(db, { ...baseOptions, workerCount: 3 });

  assert.equal(JSON.stringify(inline), JSON.stringify(pooled));
});

test("event insertion order does not change the output", async () => {
  const forwardDb = makeDbWithBars();
  insertEvents(forwardDb, makeBuys());
  const shuffledDb = makeDbWithBars();
  const shuffled = makeBuys();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = (index * 7) % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  insertEvents(shuffledDb, shuffled);

  const forward = await evaluateEventSignal(forwardDb, baseOptions);
  const reordered = await evaluateEventSignal(shuffledDb, baseOptions);

  assert.equal(JSON.stringify(forward), JSON.stringify(reordered));
});

test("a different seed changes the evidence package", async () => {
  const db = makeDbWithBars();
  insertEvents(db, makeBuys());

  const first = await evaluateEventSignal(db, baseOptions);
  const reseeded = await evaluateEventSignal(db, { ...baseOptions, seed: 43 });

  assert.notEqual(JSON.stringify(first.study), JSON.stringify(reseeded.study));
});

test("empty selection evaluates to no_signal instead of crashing", async () => {
  const db = makeDbWithBars();

  const result = await evaluateEventSignal(db, baseOptions);

  assert.equal(result.study.n_events, 0);
  assert.equal(result.verdict, "no_signal");
  assert.deepEqual(result.headline, {
    baseline_gap_t_stat: 0,
    net_abnormal_return: 0,
    n_events: 0,
  });
});

test("blockGapTStats matches hand-computed block means", () => {
  const signal = [new Float64Array([0.1]), new Float64Array([0.2]), new Float64Array([0.3])];
  const baseline = [new Float64Array([0]), new Float64Array([0]), new Float64Array([0.1])];

  const twoBlocks = blockGapTStats(signal, baseline, [[0, 1], [2]], 1);
  assert.ok(Math.abs((twoBlocks[0] as number) - 7) < 1e-12);

  const singleBlock = blockGapTStats(signal, baseline, [[0, 1, 2]], 1);
  assert.equal(singleBlock[0], null);

  const zeroVariance = blockGapTStats(signal, signal, [[0, 1], [2]], 1);
  assert.equal(zeroVariance[0], null);

  const withNaN = blockGapTStats(
    [...signal, new Float64Array([Number.NaN])],
    [...baseline, new Float64Array([Number.NaN])],
    [[0, 1], [2, 3]],
    1,
  );
  assert.ok(Math.abs((withNaN[0] as number) - 7) < 1e-12);
});
