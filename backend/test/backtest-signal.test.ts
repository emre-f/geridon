import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "../src/services/backtest.ts";
import { bar } from "./backtestFixtures.ts";
import type { EventRecord } from "../src/types/events.ts";
import type { Strategy } from "../src/types.ts";

const candles = Array.from({ length: 18 }, (_, index) => bar(index, 100 + index, 100 + index));

const clusterEvent: EventRecord = {
  id: 1,
  source: "sec_form4",
  ticker: "AAPL",
  event_kind: "insider_cluster_buy",
  event_ts_ms: candles[3].timestamp_ms,
  available_ts_ms: candles[3].timestamp_ms + 3_600_000,
  score: 5.05,
  payload: {
    insider_count: 2,
    insider_names: ["Jane Doe", "John Roe"],
    window_days: 10,
    combined_dollar_value: 112_000,
  },
  dedupe_key: "cluster-1",
};

const strategy: Strategy = {
  name: "Cluster entry, 10-bar exit",
  entry: {
    type: "rule",
    left: { type: "signal", kind: "insider_cluster_buy", output: "days_since" },
    operator: "lte",
    right: { type: "value", value: 1 },
  },
  exit: {
    type: "rule",
    left: { type: "signal", kind: "insider_cluster_buy", output: "days_since" },
    operator: "gte",
    right: { type: "value", value: 10 },
  },
};

function run(events: readonly EventRecord[]) {
  return runBacktest({
    strategy,
    candles,
    positionMode: "long_only",
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    events,
  });
}

test("event-triggered strategy produces exactly the expected trades", () => {
  const result = run([clusterEvent]);

  // Event available during bar 3 -> days_since hits 0 there, the entry rule
  // fires on bar 3's close and fills at bar 4's open; days_since reaches 10
  // at bar 13, so the exit fills at bar 14's open: held exactly 10 bars.
  const shares = 10_000 / 104;
  assert.equal(result.trades.length, 2);
  const [buy, sell] = result.trades;

  assert.equal(buy.side, "buy");
  assert.equal(buy.timestamp_ms, candles[4].timestamp_ms);
  assert.equal(buy.price, 104);
  assert.ok(Math.abs(buy.shares - shares) < 1e-9);

  assert.equal(sell.side, "sell");
  assert.equal(sell.timestamp_ms, candles[14].timestamp_ms);
  assert.equal(sell.price, 114);
  assert.ok(Math.abs(sell.shares - shares) < 1e-9);
  assert.ok(Math.abs((sell.realized_pnl ?? 0) - 10 * shares) < 1e-6);

  const finalEquity = result.equity_curve.at(-1)?.equity ?? 0;
  assert.ok(Math.abs(finalEquity - (10_000 + 10 * shares)) < 1e-6);
});

test("a ticker with zero events never trades", () => {
  const result = run([]);
  assert.equal(result.trades.length, 0);
  assert.equal(result.equity_curve.at(-1)?.equity, 10_000);
});
