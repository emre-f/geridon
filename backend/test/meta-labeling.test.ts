import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFeatureMatrix,
  computeFeatureSeries,
  featureNames,
  featureSetId,
} from "../src/services/metaLabeling/features.ts";
import { buildTradeEvents } from "../src/services/metaLabeling/tradeEvents.ts";
import { runBacktest } from "../src/services/backtest.ts";
import { thresholdStrategy, triangleCandles } from "./optimizationFixtures.ts";

function longOnlyOptions(candleCount = 400, costs?: Parameters<typeof buildTradeEvents>[0]["costs"]) {
  return {
    symbol: "TEST",
    strategy: thresholdStrategy(95, 105),
    candles: triangleCandles(candleCount),
    positionMode: "long_only" as const,
    buyPercent: 100,
    sellPercent: 100,
    initialCapital: 10_000,
    ...(costs ? { costs } : {}),
  };
}

test("trade events pair every entry with its exit and reconcile with final equity", () => {
  const options = longOnlyOptions();
  const dataset = buildTradeEvents(options);

  assert.ok(dataset.rows.length >= 10, "the triangle strategy should trade every cycle");
  for (const row of dataset.rows) {
    assert.equal(row.side, "long");
    assert.ok(row.entry_timestamp_ms < row.exit_timestamp_ms);
    assert.ok(row.exit_index > row.entry_index);
    assert.equal(row.horizon_candles, row.exit_index - row.entry_index);
    assert.equal(row.trigger_index, row.entry_index - 1);
    assert.equal(options.candles[row.entry_index].open, row.entry_price);
    assert.equal(options.candles[row.exit_index].open, row.exit_price);
    assert.equal(row.label, row.net_pnl > 0 ? 1 : 0);
  }

  const chained = dataset.rows.every(
    (row, index) => index === 0 || dataset.rows[index - 1].exit_index <= row.entry_index,
  );
  assert.ok(chained, "events must be chronological and non-overlapping");

  const totalPnl = dataset.rows.reduce((sum, row) => sum + row.net_pnl, 0);
  const simulated = runBacktest({ ...options, costs: undefined });
  const lastFlatFill = [...simulated.trades]
    .reverse()
    .find((fill) => Math.abs(fill.shares_after) < 1e-9);
  assert.ok(
    Math.abs(options.initialCapital + totalPnl - lastFlatFill!.equity_after) < 1e-6,
    "closed-trade PnL must reconcile with the simulator's equity after the last exit",
  );

  assert.deepEqual(buildTradeEvents(options), dataset, "the builder is deterministic");
});

test("labels reflect whether the trade cleared its configured costs", () => {
  const frictionless = buildTradeEvents(longOnlyOptions());
  assert.ok(frictionless.rows.length > 0);
  assert.ok(
    frictionless.rows.every((row) => row.label === 1),
    "buying the triangle lows and selling the highs wins every time without costs",
  );

  const costly = buildTradeEvents(
    longOnlyOptions(400, { commission_per_trade: 0, commission_pct: 10, slippage_bps: 0 }),
  );
  assert.equal(costly.rows.length, frictionless.rows.length);
  assert.ok(
    costly.rows.every((row) => row.label === 0),
    "a 10% commission per fill must flip every triangle trade to a loss",
  );
  for (let index = 0; index < costly.rows.length; index += 1) {
    assert.ok(costly.rows[index].net_pnl < frictionless.rows[index].net_pnl);
  }
});

test("an entry that never exits is counted as open and gets no labelled row", () => {
  const full = buildTradeEvents(longOnlyOptions(400));
  const lastEntryIndex = full.rows.at(-1)!.entry_index;

  const truncated = buildTradeEvents({
    ...longOnlyOptions(400),
    candles: triangleCandles(400).slice(0, lastEntryIndex + 2),
  });
  assert.equal(truncated.open_trades, 1);
  assert.ok(
    truncated.rows.every((row) => row.exit_index <= lastEntryIndex + 1),
    "the still-open entry must not appear as a labelled row",
  );
});

test("always_in flips close one event and open the next on the same fill", () => {
  const dataset = buildTradeEvents({
    ...longOnlyOptions(400),
    positionMode: "always_in",
  });
  assert.ok(dataset.rows.length > 2);
  const sides = new Set(dataset.rows.map((row) => row.side));
  assert.deepEqual([...sides].sort(), ["long", "short"]);
  for (let index = 1; index < dataset.rows.length; index += 1) {
    const previous = dataset.rows[index - 1];
    const current = dataset.rows[index];
    assert.equal(
      current.entry_timestamp_ms,
      previous.exit_timestamp_ms,
      "stop-and-reverse events must share their boundary fill",
    );
    assert.notEqual(current.side, previous.side);
  }
});

test("feature rows are taken at the trigger bar and use no later candles", () => {
  const candles = triangleCandles(400);
  const events = buildTradeEvents(longOnlyOptions(400)).rows;
  const matrix = buildFeatureMatrix(candles, events);

  assert.equal(matrix.feature_set_id, featureSetId);
  assert.deepEqual(matrix.feature_names, [...featureNames]);
  assert.equal(matrix.rows.length, events.length);

  for (const [rowIndex, event] of events.entries()) {
    const truncatedSeries = computeFeatureSeries(candles.slice(0, event.trigger_index + 1));
    const truncatedRow = featureNames.map(
      (name) => truncatedSeries[name][event.trigger_index] ?? null,
    );
    assert.deepEqual(
      matrix.rows[rowIndex],
      truncatedRow,
      `features for the trade triggered at bar ${event.trigger_index} must not read later candles`,
    );
  }
});

test("features warm up to numbers and stay null before their windows fill", () => {
  const candles = triangleCandles(400);
  const series = computeFeatureSeries(candles);

  assert.equal(series.rsi_14[3], null);
  assert.equal(series.macd_hist_pct[10], null);
  assert.equal(series.trend_slope_20[20], null);

  const lastIndex = candles.length - 1;
  for (const name of featureNames) {
    assert.equal(
      typeof series[name][lastIndex],
      "number",
      `${name} should be warm by the end of 400 candles`,
    );
    assert.equal(series[name].length, candles.length);
  }
});
