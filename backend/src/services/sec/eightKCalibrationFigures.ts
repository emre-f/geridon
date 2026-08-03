import type { GuidanceFigure } from "./eightKLabelSchema.ts";

export interface CountedPair {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
}

/**
 * Two labelers describing the same guided period write it differently -
 * "FY 2023", "FY2023", "Fiscal 2023", "Full Year 2023" are one period, as are
 * "Q1 2023", "1Q 2023" and "first quarter 2023". Collapsing them to a canonical
 * token measures whether the figure was extracted, not whether the two happened
 * to format the period the same way.
 */
function canonicalPeriod(period: string): string {
  let p = period.toLowerCase().replace(/[^a-z0-9]/g, "");
  p = p
    .replace(/fullyear/g, "fy")
    .replace(/fiscalyear/g, "fy")
    .replace(/fiscal/g, "fy")
    .replace(/calendaryear/g, "fy");
  p = p
    .replace(/firstquarter/g, "q1")
    .replace(/secondquarter/g, "q2")
    .replace(/thirdquarter/g, "q3")
    .replace(/fourthquarter/g, "q4");
  return p.replace(/([1-4])q(?=\d)/g, "q$1");
}

const metricStopWords = new Set([
  "the", "of", "a", "an", "for", "on", "under", "to", "is", "in", "at",
  "vs", "versus", "per", "from", "with", "its", "by", "and", "or",
]);

/**
 * Metric names are free text, so the same measure appears as "adjusted EPS",
 * "EPS (adjusted)", "adjusted earnings per share". A fingerprint - expand the
 * EPS abbreviation, drop punctuation and filler words, then compare the set of
 * significant words regardless of order - matches those without collapsing
 * genuinely different metrics (a distinguishing word like "GAAP", "diluted" or
 * "organic" still separates them).
 */
function metricWords(metric: string): Set<string> {
  const expanded = metric.toLowerCase().replace(/&/g, " ").replace(/\beps\b/g, "earnings per share");
  const words = expanded
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !metricStopWords.has(word));
  return new Set(words);
}

function normalizeUnit(unit: string): string {
  return unit.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function exactKey(figure: GuidanceFigure): string {
  const numbers = [figure.low, figure.high, figure.point].map((value) =>
    value == null ? "null" : value.toFixed(6),
  );
  const fingerprint = [...metricWords(figure.metric)].sort().join(" ");
  return [fingerprint, canonicalPeriod(figure.period), normalizeUnit(figure.unit), ...numbers].join("|");
}

/**
 * The slot-agnostic numeric identity: labelers split on whether "at least
 * $150M" is `low=150` or `point=150`, but a figure with the same values in the
 * same period and unit is the same figure regardless of which slots hold them.
 */
function looseKey(figure: GuidanceFigure): string {
  const values = [figure.low, figure.high, figure.point]
    .filter((value): value is number => value != null)
    .map((value) => value.toFixed(6))
    .sort();
  return [canonicalPeriod(figure.period), normalizeUnit(figure.unit), ...values].join("|");
}

/**
 * One name may carry qualifiers the other omits - "non-GAAP gross margin" vs
 * "gross margin", "Same-Home Core revenues growth" vs "Core revenues growth".
 * When the period, unit and values already pin the figure down, a word-subset
 * relation between the names is agreement, not error; names that diverge in
 * both directions ("revenue" vs "cash flow") stay distinct.
 */
function compatibleMetrics(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) {
    return false;
  }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].every((word) => large.has(word));
}

/**
 * Figures are compared as multisets: a filing can guide several metrics, and
 * the order the model happens to list them in carries no meaning. Matching is
 * two-pass - exact fingerprints first so each prediction lands on its closest
 * gold figure, then the canonical pass sweeps up naming and slot variants.
 */
export function countFigures(gold: GuidanceFigure[], predicted: GuidanceFigure[], into: CountedPair): void {
  const used = predicted.map(() => false);
  const goldMatched = gold.map(() => false);

  gold.forEach((goldFigure, goldIndex) => {
    const key = exactKey(goldFigure);
    const index = predicted.findIndex((figure, i) => !used[i] && exactKey(figure) === key);
    if (index !== -1) {
      used[index] = true;
      goldMatched[goldIndex] = true;
    }
  });

  gold.forEach((goldFigure, goldIndex) => {
    if (goldMatched[goldIndex]) {
      return;
    }
    const key = looseKey(goldFigure);
    const words = metricWords(goldFigure.metric);
    const index = predicted.findIndex(
      (figure, i) => !used[i] && looseKey(figure) === key && compatibleMetrics(words, metricWords(figure.metric)),
    );
    if (index !== -1) {
      used[index] = true;
      goldMatched[goldIndex] = true;
    }
  });

  const matched = goldMatched.filter(Boolean).length;
  into.true_positives += matched;
  into.false_negatives += gold.length - matched;
  into.false_positives += predicted.length - matched;
}
