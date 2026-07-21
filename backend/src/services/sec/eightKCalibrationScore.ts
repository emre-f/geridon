import { labelKinds, type FilingLabel, type GuidanceFigure, type LabelKind } from "./eightKLabelSchema.ts";

/**
 * The stated accuracy bar. These are fixed constants, not tunables: lowering a
 * threshold because a labeler missed it would make the gate meaningless.
 * `minPerKindF1` only binds on kinds the gold set actually covers, so a kind
 * with three examples cannot fail the run on one disagreement.
 */
export const accuracyBar = {
  minKindF1: 0.85,
  minPerKindF1: 0.75,
  perKindMinSupport: 5,
  minDirectionAccuracy: 0.9,
  minSeverityWithinOne: 0.9,
  minGuidanceFigureF1: 0.8,
  maxCleanFilingFalsePositiveRate: 0.1,
} as const;

export interface CountedPair {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
}

export interface KindScore extends CountedPair {
  kind: LabelKind;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CalibrationScore {
  filings_scored: number;
  filings_missing_labels: string[];
  kinds: KindScore[];
  kind_f1: number;
  matched_labels: number;
  direction_accuracy: number;
  severity_within_one: number;
  guidance_figure_f1: number;
  clean_filings: number;
  clean_filing_false_positives: number;
  clean_filing_false_positive_rate: number;
  passed: boolean;
  failures: string[];
}

export interface ScoredFiling {
  accession_path: string;
  gold: FilingLabel[];
  predicted: FilingLabel[] | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function f1(counts: CountedPair): number {
  const precision = ratio(counts.true_positives, counts.true_positives + counts.false_positives);
  const recall = ratio(counts.true_positives, counts.true_positives + counts.false_negatives);
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
function metricFingerprint(metric: string): string {
  const expanded = metric.toLowerCase().replace(/&/g, " ").replace(/\beps\b/g, "earnings per share");
  const words = expanded
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !metricStopWords.has(word));
  return [...new Set(words)].sort().join(" ");
}

function figureKey(figure: GuidanceFigure): string {
  const numbers = [figure.low, figure.high, figure.point].map((value) =>
    value == null ? "null" : value.toFixed(6),
  );
  return [metricFingerprint(figure.metric), canonicalPeriod(figure.period), normalize(figure.unit), ...numbers].join("|");
}

/**
 * Figures are compared as multisets: a filing can guide several metrics, and
 * the order the model happens to list them in carries no meaning.
 */
function countFigures(gold: GuidanceFigure[], predicted: GuidanceFigure[], into: CountedPair): void {
  const remaining = new Map<string, number>();
  for (const figure of predicted) {
    const key = figureKey(figure);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let matched = 0;
  for (const figure of gold) {
    const key = figureKey(figure);
    const available = remaining.get(key) ?? 0;
    if (available > 0) {
      remaining.set(key, available - 1);
      matched += 1;
    }
  }
  into.true_positives += matched;
  into.false_negatives += gold.length - matched;
  into.false_positives += predicted.length - matched;
}

function emptyCounts(): CountedPair {
  return { true_positives: 0, false_positives: 0, false_negatives: 0 };
}

/**
 * Labels within a filing have no identity, so a kind's gold and predicted
 * labels are matched positionally after grouping. An unplanned departure
 * labeled routine therefore costs twice - a miss on one kind and a false
 * positive on the other - which is the intended strictness for the split the
 * 5.02 ticket asked for.
 */
export function scoreCalibration(filings: ScoredFiling[]): CalibrationScore {
  const counts = new Map<LabelKind, CountedPair>(labelKinds.map((kind) => [kind, emptyCounts()]));
  const support = new Map<LabelKind, number>(labelKinds.map((kind) => [kind, 0]));
  const figures = emptyCounts();

  const missing: string[] = [];
  let scored = 0;
  let matchedLabels = 0;
  let directionAgreements = 0;
  let severityAgreements = 0;
  let cleanFilings = 0;
  let cleanFilingFalsePositives = 0;

  for (const filing of filings) {
    if (filing.predicted == null) {
      missing.push(filing.accession_path);
      continue;
    }
    scored += 1;
    if (filing.gold.length === 0) {
      cleanFilings += 1;
      if (filing.predicted.length > 0) {
        cleanFilingFalsePositives += 1;
      }
    }

    for (const kind of labelKinds) {
      const gold = filing.gold.filter((label) => label.kind === kind);
      const predicted = filing.predicted.filter((label) => label.kind === kind);
      const pairs = Math.min(gold.length, predicted.length);
      const kindCounts = counts.get(kind)!;
      kindCounts.true_positives += pairs;
      kindCounts.false_negatives += gold.length - pairs;
      kindCounts.false_positives += predicted.length - pairs;
      support.set(kind, support.get(kind)! + gold.length);

      for (let index = 0; index < pairs; index += 1) {
        matchedLabels += 1;
        if (gold[index].direction === predicted[index].direction) {
          directionAgreements += 1;
        }
        if (Math.abs(gold[index].severity - predicted[index].severity) <= 1) {
          severityAgreements += 1;
        }
        if (kind === "guidance") {
          countFigures(gold[index].guidance, predicted[index].guidance, figures);
        }
      }
    }
  }

  const kinds: KindScore[] = labelKinds.map((kind) => {
    const kindCounts = counts.get(kind)!;
    return {
      kind,
      support: support.get(kind)!,
      ...kindCounts,
      precision: ratio(kindCounts.true_positives, kindCounts.true_positives + kindCounts.false_positives),
      recall: ratio(kindCounts.true_positives, kindCounts.true_positives + kindCounts.false_negatives),
      f1: f1(kindCounts),
    };
  });

  const totals = kinds.reduce<CountedPair>((into, kind) => {
    into.true_positives += kind.true_positives;
    into.false_positives += kind.false_positives;
    into.false_negatives += kind.false_negatives;
    return into;
  }, emptyCounts());

  const score: CalibrationScore = {
    filings_scored: scored,
    filings_missing_labels: missing,
    kinds,
    kind_f1: f1(totals),
    matched_labels: matchedLabels,
    direction_accuracy: ratio(directionAgreements, matchedLabels),
    severity_within_one: ratio(severityAgreements, matchedLabels),
    guidance_figure_f1: f1(figures),
    clean_filings: cleanFilings,
    clean_filing_false_positives: cleanFilingFalsePositives,
    clean_filing_false_positive_rate: cleanFilings === 0 ? 0 : cleanFilingFalsePositives / cleanFilings,
    passed: false,
    failures: [],
  };
  score.failures = collectFailures(score);
  score.passed = score.failures.length === 0;
  return score;
}

function collectFailures(score: CalibrationScore): string[] {
  const failures: string[] = [];
  const check = (name: string, value: number, minimum: number): void => {
    if (value < minimum) {
      failures.push(`${name} ${value.toFixed(3)} is below the bar ${minimum.toFixed(2)}`);
    }
  };

  if (score.filings_missing_labels.length > 0) {
    failures.push(`${score.filings_missing_labels.length} calibration filings have no label for this version`);
  }
  check("kind F1", score.kind_f1, accuracyBar.minKindF1);
  for (const kind of score.kinds) {
    if (kind.support >= accuracyBar.perKindMinSupport) {
      check(`${kind.kind} F1`, kind.f1, accuracyBar.minPerKindF1);
    }
  }
  check("direction accuracy", score.direction_accuracy, accuracyBar.minDirectionAccuracy);
  check("severity within 1", score.severity_within_one, accuracyBar.minSeverityWithinOne);
  check("guidance figure F1", score.guidance_figure_f1, accuracyBar.minGuidanceFigureF1);
  if (score.clean_filing_false_positive_rate > accuracyBar.maxCleanFilingFalsePositiveRate) {
    failures.push(
      `clean-filing false positive rate ${score.clean_filing_false_positive_rate.toFixed(3)} ` +
        `exceeds the bar ${accuracyBar.maxCleanFilingFalsePositiveRate.toFixed(2)}`,
    );
  }
  return failures;
}
