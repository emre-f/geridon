import { anchorEvents } from "./eventAnchor.ts";
import { passesPayloadFilters } from "./signalEval/eventSelection.ts";
import type { EventKind, EventRecord } from "../types/events.ts";
import type {
  Candle,
  SignalOperand,
  Strategy,
  StrategyCondition,
  StrategyOperand,
} from "../types.ts";

type NumericSeries = Array<number | null>;

export function collectSignalKinds(strategy: Strategy): EventKind[] {
  const kinds = new Set<EventKind>();
  const visitOperand = (operand: StrategyOperand) => {
    if (operand.type === "signal") {
      kinds.add(operand.kind);
    }
  };
  const visit = (condition: StrategyCondition) => {
    if (condition.type === "rule") {
      visitOperand(condition.left);
      visitOperand(condition.right);
      return;
    }
    condition.conditions.forEach(visit);
  };
  visit(strategy.entry);
  visit(strategy.exit);
  if (strategy.cash) {
    visit(strategy.cash);
  }
  return [...kinds].sort();
}

function matchesOperand(event: EventRecord, operand: SignalOperand): boolean {
  if (event.event_kind !== operand.kind) {
    return false;
  }
  if (!operand.filters) {
    return true;
  }
  const { score: minScore, ...payloadFilters } = operand.filters;
  if (minScore != null && (event.score == null || event.score < minScore)) {
    return false;
  }
  return passesPayloadFilters(event.payload, payloadFilters);
}

/**
 * Resolves a signal operand to a per-bar series over the ticker's candles.
 * Each event is anchored at the last bar whose timestamp is at or before its
 * available_ts, so a rule firing on that bar's close fills at the next bar's
 * open — the first actionable moment per the timing convention. Events
 * available before the first bar have no anchor and are dropped.
 */
export function buildSignalSeries(
  operand: SignalOperand,
  events: readonly EventRecord[],
  candles: readonly Candle[],
): NumericSeries {
  const matching = events
    .filter((event) => matchesOperand(event, operand))
    .sort(
      (left, right) =>
        left.available_ts_ms - right.available_ts_ms || (left.id ?? 0) - (right.id ?? 0),
    );
  const anchors = anchorEvents(
    matching.map((event) => event.available_ts_ms),
    candles.map((candle) => candle.timestamp_ms),
  );

  const eventCounts = new Array<number>(candles.length).fill(0);
  const anchorScores = new Array<number | null | undefined>(candles.length).fill(undefined);
  matching.forEach((event, index) => {
    const anchor = anchors[index];
    if (anchor == null) {
      return;
    }
    eventCounts[anchor.anchor_index] += 1;
    anchorScores[anchor.anchor_index] = event.score;
  });

  if (operand.output === "count_in_window") {
    return countInWindow(eventCounts, operand.window ?? 1);
  }
  if (operand.output === "last_score") {
    return lastScore(anchorScores);
  }
  return daysSince(eventCounts);
}

function daysSince(eventCounts: readonly number[]): NumericSeries {
  const series: NumericSeries = new Array(eventCounts.length);
  let lastAnchor = -1;
  for (let index = 0; index < eventCounts.length; index += 1) {
    if (eventCounts[index] > 0) {
      lastAnchor = index;
    }
    series[index] = lastAnchor < 0 ? Infinity : index - lastAnchor;
  }
  return series;
}

function countInWindow(eventCounts: readonly number[], window: number): NumericSeries {
  const series: NumericSeries = new Array(eventCounts.length);
  let sum = 0;
  for (let index = 0; index < eventCounts.length; index += 1) {
    sum += eventCounts[index];
    if (index - window >= 0) {
      sum -= eventCounts[index - window];
    }
    series[index] = sum;
  }
  return series;
}

function lastScore(anchorScores: ReadonlyArray<number | null | undefined>): NumericSeries {
  const series: NumericSeries = new Array(anchorScores.length);
  let current: number | null = null;
  for (let index = 0; index < anchorScores.length; index += 1) {
    const score = anchorScores[index];
    if (score !== undefined) {
      current = score;
    }
    series[index] = current;
  }
  return series;
}
