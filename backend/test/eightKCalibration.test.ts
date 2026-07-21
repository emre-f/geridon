import assert from "node:assert/strict";
import test from "node:test";

import { selectCalibrationSample } from "../src/services/sec/eightKCalibrationSet.ts";
import {
  accuracyBar,
  scoreCalibration,
  type ScoredFiling,
} from "../src/services/sec/eightKCalibrationScore.ts";
import type { FilingLabel } from "../src/services/sec/eightKLabelSchema.ts";
import type { CachedFiling } from "../src/services/sec/eightKLabelStore.ts";

function cachedFiling(index: number, items: string[]): CachedFiling {
  return {
    cik: 1111,
    accession_path: `00011112400${String(index).padStart(4, "0")}`,
    dir: `/tmp/${index}`,
    form: "8-K",
    items,
    filed_date: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
    acceptance_ts_ms: 1_700_000_000_000 + index,
    primary: "body.htm",
    exhibits: [],
  };
}

function label(overrides: Partial<FilingLabel> = {}): FilingLabel {
  return {
    kind: "guidance",
    direction: "up",
    severity: 3,
    rationale: "raised outlook",
    guidance: [],
    ...overrides,
  };
}

function perfect(count: number, gold: FilingLabel[]): ScoredFiling[] {
  return Array.from({ length: count }, (_unused, index) => ({
    accession_path: `filing-${index}`,
    gold,
    predicted: gold,
  }));
}

const universe = [
  ...Array.from({ length: 60 }, (_unused, index) => cachedFiling(index, ["2.02", "9.01"])),
  ...Array.from({ length: 40 }, (_unused, index) => cachedFiling(index + 60, ["5.02"])),
  ...Array.from({ length: 10 }, (_unused, index) => cachedFiling(index + 100, ["7.01"])),
];

test("the calibration sample is deterministic and ignores unfetched items", () => {
  const tickers = new Map([[1111, "ABCD"]]);
  const first = selectCalibrationSample(universe, tickers, 20);
  const second = selectCalibrationSample([...universe].reverse(), tickers, 20);

  assert.equal(first.length, 20);
  assert.deepEqual(
    first.map((entry) => entry.accession_path).sort(),
    second.map((entry) => entry.accession_path).sort(),
  );
  assert.ok(first.every((entry) => entry.items.includes("2.02") || entry.items.includes("5.02")));
  assert.equal(new Set(first.map((entry) => entry.accession_path)).size, 20);
});

test("the sample keeps both item families in proportion", () => {
  const sampled = selectCalibrationSample(universe, new Map([[1111, "ABCD"]]), 20);
  const byStratum = sampled.filter((entry) => entry.stratum === "2.02").length;
  assert.equal(byStratum, 12);
  assert.equal(sampled.length - byStratum, 8);
});

test("growing the cache does not reshuffle an existing sample", () => {
  const tickers = new Map([[1111, "ABCD"]]);
  const before = selectCalibrationSample(universe, tickers, 10);
  const after = selectCalibrationSample(
    [...universe, ...Array.from({ length: 50 }, (_unused, index) => cachedFiling(index + 200, ["2.02"]))],
    tickers,
    10,
  );
  const kept = after.filter((entry) =>
    before.some((original) => original.accession_path === entry.accession_path),
  );
  assert.ok(kept.length >= 5, `expected most of the original sample to survive, kept ${kept.length}`);
});

test("a labeler that reproduces the gold set passes every bar", () => {
  const score = scoreCalibration([
    ...perfect(10, [label()]),
    ...perfect(10, []),
    ...perfect(5, [label({ kind: "exec_departure_unplanned", direction: "down", severity: 4 })]),
  ]);

  assert.equal(score.passed, true);
  assert.deepEqual(score.failures, []);
  assert.equal(score.kind_f1, 1);
  assert.equal(score.clean_filings, 10);
  assert.equal(score.clean_filing_false_positive_rate, 0);
});

test("confusing an unplanned departure for a routine one costs both kinds", () => {
  const score = scoreCalibration([
    {
      accession_path: "a",
      gold: [label({ kind: "exec_departure_unplanned" })],
      predicted: [label({ kind: "exec_departure_routine" })],
    },
  ]);

  const unplanned = score.kinds.find((kind) => kind.kind === "exec_departure_unplanned")!;
  const routine = score.kinds.find((kind) => kind.kind === "exec_departure_routine")!;
  assert.equal(unplanned.false_negatives, 1);
  assert.equal(routine.false_positives, 1);
  assert.equal(score.kind_f1, 0);
  assert.equal(score.matched_labels, 0);
  assert.equal(score.passed, false);
});

test("hallucinated labels on clean filings fail the run on their own", () => {
  const score = scoreCalibration([
    ...perfect(20, [label()]),
    ...Array.from({ length: 10 }, (_unused, index) => ({
      accession_path: `clean-${index}`,
      gold: [],
      predicted: index < 3 ? [label()] : [],
    })),
  ]);

  assert.equal(score.clean_filing_false_positives, 3);
  assert.ok(score.clean_filing_false_positive_rate > accuracyBar.maxCleanFilingFalsePositiveRate);
  assert.equal(score.passed, false);
  assert.ok(score.failures.some((failure) => failure.includes("clean-filing")));
});

test("direction and severity are scored only on matched labels", () => {
  const score = scoreCalibration([
    { accession_path: "a", gold: [label({ direction: "up" })], predicted: [label({ direction: "down" })] },
    { accession_path: "b", gold: [label({ severity: 5 })], predicted: [label({ severity: 2 })] },
    ...perfect(8, [label()]),
  ]);

  assert.equal(score.matched_labels, 10);
  assert.equal(score.direction_accuracy, 0.9);
  assert.equal(score.severity_within_one, 0.9);
  assert.equal(score.kind_f1, 1);
});

test("guidance figures are compared as a multiset, unit included", () => {
  const figure = { metric: "Revenue", period: "FY 2025", unit: "USD billions", low: 5.1, high: 5.3, point: null };
  const score = scoreCalibration([
    {
      accession_path: "order",
      gold: [label({ guidance: [figure, { ...figure, metric: "EPS", unit: "USD per share", low: 1, high: 2 }] })],
      predicted: [
        label({ guidance: [{ ...figure, metric: "eps", unit: "usd per share", low: 1, high: 2 }, { ...figure, metric: "  revenue " }] }),
      ],
    },
  ]);
  assert.equal(score.guidance_figure_f1, 1);

  const wrongUnit = scoreCalibration([
    {
      accession_path: "unit",
      gold: [label({ guidance: [figure] })],
      predicted: [label({ guidance: [{ ...figure, unit: "USD millions" }] })],
    },
  ]);
  assert.equal(wrongUnit.guidance_figure_f1, 0);
  assert.ok(wrongUnit.failures.some((failure) => failure.includes("guidance figure")));
});

test("a filing the labeler never labeled fails the run rather than being skipped", () => {
  const score = scoreCalibration([...perfect(20, [label()]), { accession_path: "x", gold: [], predicted: null }]);

  assert.equal(score.filings_scored, 20);
  assert.deepEqual(score.filings_missing_labels, ["x"]);
  assert.equal(score.passed, false);
  assert.ok(score.failures.some((failure) => failure.includes("no label for this version")));
});

test("a rare kind cannot fail the run on a single disagreement", () => {
  const score = scoreCalibration([
    ...perfect(40, [label()]),
    { accession_path: "rare", gold: [label({ kind: "buyback" })], predicted: [label({ kind: "buyback" })] },
    { accession_path: "rare-2", gold: [label({ kind: "buyback" })], predicted: [] },
  ]);

  const buyback = score.kinds.find((kind) => kind.kind === "buyback")!;
  assert.ok(buyback.support < accuracyBar.perKindMinSupport);
  assert.ok(buyback.f1 < accuracyBar.minPerKindF1);
  assert.equal(score.passed, true);
});
