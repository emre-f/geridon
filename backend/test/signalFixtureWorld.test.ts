import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateEventSignal,
  type EvaluateSignalOptions,
  type SignalEvaluationPackage,
} from "../src/services/signalEval/evaluate.ts";
import type { EventKind } from "../src/types/events.ts";
import { buildFixtureWorld, fixtureEffectBars } from "./signalFixtureWorld.ts";

/**
 * The fixture world repeats every 42 bars, so the study window stays inside
 * one cycle; the default 63-bar window would read the next cycle's rise as a
 * second peak.
 */
const evaluationOptions = (kind: EventKind): EvaluateSignalOptions => ({
  query: { kind },
  seed: 7,
  bootstrapIterations: 50,
  maxHorizon: 2 * fixtureEffectBars,
});

function gapAtEffectHorizon(result: SignalEvaluationPackage): number {
  const point = result.study.curve.find((entry) => entry.horizon === fixtureEffectBars);
  assert.ok(point?.gap != null, "expected a gap at the planted effect horizon");
  return point.gap;
}

const honestWorld = buildFixtureWorld();

test("planted +2% effect stream evaluates to candidate", async () => {
  const result = await evaluateEventSignal(honestWorld.db, evaluationOptions("insider_cluster_buy"));

  assert.ok(honestWorld.realEventCount >= 500);
  assert.equal(result.selection.selected, honestWorld.realEventCount);
  assert.equal(result.study.n_events, honestWorld.realEventCount);

  const gap = gapAtEffectHorizon(result);
  assert.ok(gap > 0.015 && gap < 0.025, `expected ~+2% gap at ${fixtureEffectBars} bars, got ${gap}`);

  const holding = result.horizon_summary.natural_holding_period_bars;
  assert.ok(holding != null && holding >= 15 && holding <= 25, `holding period ${holding}`);

  assert.ok(result.headline.baseline_gap_t_stat >= 3);
  assert.ok(result.headline.net_abnormal_return > 0.01);
  assert.equal(result.verdict, "candidate");
});

test("pure-noise event stream evaluates to no_signal", async () => {
  const result = await evaluateEventSignal(honestWorld.db, evaluationOptions("insider_buy"));

  assert.equal(result.study.n_events, honestWorld.noiseEventCount);
  const gap = gapAtEffectHorizon(result);
  assert.ok(Math.abs(gap) < 0.005, `noise gap should be flat, got ${gap}`);
  assert.equal(result.verdict, "no_signal");
});

test("lookahead-contaminated stream is caught by the timing convention", async () => {
  const honest = await evaluateEventSignal(honestWorld.db, evaluationOptions("insider_sell"));

  const honestGap = gapAtEffectHorizon(honest);
  assert.ok(honestGap < -0.015, `honest anchoring should ride the reversion, got ${honestGap}`);
  assert.equal(honest.verdict, "no_signal");

  const leakedWorld = buildFixtureWorld("leaked");
  const leaked = await evaluateEventSignal(leakedWorld.db, evaluationOptions("insider_sell"));

  assert.equal(leaked.study.n_events, leakedWorld.lookaheadEventCount);
  const leakedGap = gapAtEffectHorizon(leaked);
  assert.ok(leakedGap > 0.015, `event_ts anchoring should fabricate the +2%, got ${leakedGap}`);
  assert.equal(leaked.verdict, "candidate");
});
