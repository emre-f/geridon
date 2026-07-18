import { createDb, openDatabase, type Database } from "../src/db.ts";
import { insertEvents } from "../src/services/eventStore.ts";
import { SeededRandom } from "../src/services/optimization/random.ts";
import { defaultMarketTicker } from "../src/services/signalEval/evaluate.ts";
import type { EventRecord } from "../src/types/events.ts";

export const fixtureDayMs = 86_400_000;
export const fixtureFirstBarMs = Date.UTC(2020, 0, 6);
export const fixtureBarCount = 1200;
export const fixtureCycleBars = 42;
export const fixtureEffectBars = 20;
export const fixtureEffectSize = 0.02;

const tickerCount = 20;
const noiseEventsPerTicker = 25;
const noiseAnchorSeed = 61_803;
const maxHorizonBars = 63;

export const fixtureBarMs = (index: number) => fixtureFirstBarMs + index * fixtureDayMs;

export type LookaheadAvailability = "honest" | "leaked";

export interface FixtureWorld {
  db: Database;
  realEventCount: number;
  noiseEventCount: number;
  lookaheadEventCount: number;
}

const tickers = Array.from(
  { length: tickerCount },
  (_, index) => `SYN${String(index).padStart(2, "0")}`,
);

function marketClose(index: number): number {
  return 400 * (1 + 0.0002 * index + 0.01 * Math.sin(index * 0.13));
}

function cyclePhase(index: number, tickerIndex: number): number {
  const offset = tickerIndex * 2;
  return ((((index - offset) % fixtureCycleBars) + fixtureCycleBars) % fixtureCycleBars);
}

function cycleFactor(phase: number): number {
  if (phase <= fixtureEffectBars) {
    return 1 + fixtureEffectSize * (phase / fixtureEffectBars);
  }
  if (phase <= 2 * fixtureEffectBars) {
    return 1 + fixtureEffectSize * ((2 * fixtureEffectBars - phase) / fixtureEffectBars);
  }
  return 1;
}

function tickerClose(index: number, tickerIndex: number): number {
  const base = 20 + tickerIndex;
  const marketFactor = marketClose(index) / marketClose(0);
  const noise = 1 + 0.002 * Math.sin(index * 0.9 + tickerIndex * 2.3);
  return base * marketFactor * cycleFactor(cyclePhase(index, tickerIndex)) * noise;
}

/**
 * Bar indexes where a new sawtooth cycle is about to start: the rise covers
 * the 20 bars beginning at the next bar, so an event anchored here gains
 * exactly +2% market-adjusted over horizons 1..20 and gives it all back by
 * horizon 40. Only anchors with the full 63-bar forward curve are used.
 */
function riseAnchorIndexes(tickerIndex: number): number[] {
  const anchors: number[] = [];
  const lastUsable = fixtureBarCount - 1 - (maxHorizonBars + 1);
  const first = tickerIndex * 2 + fixtureCycleBars - 1;
  for (let anchor = first; anchor <= lastUsable; anchor += fixtureCycleBars) {
    anchors.push(anchor);
  }
  return anchors;
}

function realEvents(): EventRecord[] {
  return tickers.flatMap((ticker, tickerIndex) =>
    riseAnchorIndexes(tickerIndex).map((anchor, cycle): EventRecord<"insider_cluster_buy"> => {
      const combinedValue = 100_000 * (1 + (cycle % 5));
      return {
        source: "sec_form4",
        ticker,
        event_kind: "insider_cluster_buy",
        event_ts_ms: fixtureBarMs(anchor) - 2 * fixtureDayMs,
        available_ts_ms: fixtureBarMs(anchor) + 1_000,
        score: Math.log10(combinedValue),
        payload: {
          insider_count: 2 + (cycle % 3),
          insider_names: [`Officer ${ticker}`, `Director ${ticker}`],
          window_days: 10,
          combined_dollar_value: combinedValue,
        },
        dedupe_key: `real-${ticker}-${cycle}`,
      };
    }),
  );
}

function noiseEvents(): EventRecord[] {
  const rng = new SeededRandom(noiseAnchorSeed);
  return tickers.flatMap((ticker, tickerIndex) => {
    const anchors = new Set<number>();
    while (anchors.size < noiseEventsPerTicker) {
      anchors.add(rng.nextInt(70, fixtureBarCount - 1 - (maxHorizonBars + 1)));
    }
    return [...anchors].sort((left, right) => left - right).map(
      (anchor, position): EventRecord<"insider_buy"> => {
        const shares = 200 + position * 10;
        const price = tickerClose(anchor, tickerIndex);
        return {
          source: "sec_form4",
          ticker,
          event_kind: "insider_buy",
          event_ts_ms: fixtureBarMs(anchor) - fixtureDayMs,
          available_ts_ms: fixtureBarMs(anchor) + 1_000,
          score: 3 + (position % 7) * 0.3,
          payload: {
            insider_name: `Insider ${ticker} ${position}`,
            is_officer: position % 2 === 0,
            is_director: position % 3 === 0,
            is_ten_percent_owner: false,
            shares,
            price,
            dollar_value: shares * price,
          },
          dedupe_key: `noise-${ticker}-${anchor}`,
        };
      },
    );
  });
}

/**
 * The contaminated stream: event_ts sits right before the rise (the insider
 * knew), but the public filing lands only once the move is complete. Honest
 * anchoring on available_ts makes the entry bar the exact top of the sawtooth,
 * so no forward horizon can show a real gain; anchoring on event_ts ("leaked")
 * fabricates the +2%.
 */
function lookaheadEvents(availability: LookaheadAvailability): EventRecord[] {
  return tickers.flatMap((ticker, tickerIndex) =>
    riseAnchorIndexes(tickerIndex).map((anchor, cycle): EventRecord<"insider_sell"> => {
      const eventTsMs = fixtureBarMs(anchor) + 1_000;
      const filedTsMs = fixtureBarMs(anchor + fixtureEffectBars) + 1_000;
      const shares = 500 + cycle * 20;
      const price = tickerClose(anchor, tickerIndex);
      return {
        source: "sec_form4",
        ticker,
        event_kind: "insider_sell",
        event_ts_ms: eventTsMs,
        available_ts_ms: availability === "honest" ? filedTsMs : eventTsMs,
        score: 4 + (cycle % 4) * 0.4,
        payload: {
          insider_name: `Late Filer ${ticker}`,
          is_officer: true,
          is_director: false,
          is_ten_percent_owner: false,
          shares,
          price,
          dollar_value: shares * price,
        },
        dedupe_key: `lookahead-${ticker}-${cycle}`,
      };
    }),
  );
}

export function buildFixtureWorld(
  lookaheadAvailability: LookaheadAvailability = "honest",
): FixtureWorld {
  const db = openDatabase("sqlite:///:memory:");
  createDb(db);

  const insert = db.prepare(`
    INSERT INTO candles (ticker, multiplier, timespan, timestamp_ms, open, high, low, close, volume)
    VALUES (?, 1, 'day', ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  for (let index = 0; index < fixtureBarCount; index += 1) {
    const spy = marketClose(index);
    insert.run(defaultMarketTicker, fixtureBarMs(index), spy, spy, spy, spy, 1_000_000);
    tickers.forEach((ticker, tickerIndex) => {
      const close = tickerClose(index, tickerIndex);
      insert.run(ticker, fixtureBarMs(index), close, close, close, close, 1_000_000);
    });
  }
  db.exec("COMMIT");

  const real = realEvents();
  const noise = noiseEvents();
  const lookahead = lookaheadEvents(lookaheadAvailability);
  insertEvents(db, [...real, ...noise, ...lookahead]);

  return {
    db,
    realEventCount: real.length,
    noiseEventCount: noise.length,
    lookaheadEventCount: lookahead.length,
  };
}
