import type { EventRecord, GuidanceRevisionPayload } from "../../types/events.ts";
import type { GuidanceFigure } from "./eightKLabelSchema.ts";
import type { CachedFiling, StoredLabelSet } from "./eightKLabelStore.ts";

export type GuidanceEventKind = "guidance_raise" | "guidance_cut";

export interface GuidanceEventSkipCounts {
  initiation: number;
  reaffirmation: number;
  withdrawal_no_prior: number;
  incomparable: number;
}

export function emptyGuidanceEventSkipCounts(): GuidanceEventSkipCounts {
  return { initiation: 0, reaffirmation: 0, withdrawal_no_prior: 0, incomparable: 0 };
}

/**
 * A figure's central value: the point if given, else the range midpoint, else
 * whichever single bound exists (an open-ended "at least"/"up to" guide). All
 * three null means the filer named a metric/period with no number, which the
 * caller reads as a withdrawal marker.
 */
export function guidanceMidpoint(figure: GuidanceFigure): number | null {
  if (figure.point != null) {
    return figure.point;
  }
  if (figure.low != null && figure.high != null) {
    return (figure.low + figure.high) / 2;
  }
  if (figure.low != null) {
    return figure.low;
  }
  if (figure.high != null) {
    return figure.high;
  }
  return null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A figure can only be compared across filings if it names a metric, period and
 * unit. The current parser guarantees all three, but the run reads cached JSON
 * without re-validating, so a legacy or hand-edited label missing a field is
 * skipped rather than allowed to crash the walk.
 */
function hasStableIdentity(figure: GuidanceFigure): boolean {
  return (
    typeof figure.metric === "string" &&
    figure.metric.trim().length > 0 &&
    typeof figure.period === "string" &&
    figure.period.trim().length > 0 &&
    typeof figure.unit === "string" &&
    figure.unit.trim().length > 0
  );
}

/**
 * Two guides describe the same outlook only when metric, period and unit all
 * match after normalization. Unit must match because a raise/cut comparison
 * across scales is meaningless - revenue in billions is not comparable to the
 * same metric in millions.
 */
export function guidanceKey(figure: GuidanceFigure): string {
  return `${normalize(figure.metric)}|${normalize(figure.period)}|${normalize(figure.unit)}`;
}

interface PriorGuide {
  figure: GuidanceFigure;
  midpoint: number;
  accession: string;
}

/** Every guidance figure a filing carries, flattened across its labels in order. */
function filingGuidance(labelSet: StoredLabelSet): GuidanceFigure[] {
  return labelSet.labels.flatMap((label) => label.guidance);
}

function makeEvent(
  filing: CachedFiling,
  ticker: string,
  kind: GuidanceEventKind,
  labelerVersion: string,
  newFigure: GuidanceFigure,
  prior: PriorGuide,
  newMidpoint: number | null,
  revisionPct: number | null,
  withdrawn: boolean,
): EventRecord<GuidanceEventKind> {
  const payload: GuidanceRevisionPayload = {
    cik: filing.cik,
    accession: filing.accession_path,
    prior_accession: prior.accession,
    new_figure: newFigure,
    prior_figure: prior.figure,
    new_midpoint: newMidpoint,
    prior_midpoint: prior.midpoint,
    revision_pct: revisionPct,
    withdrawn,
    labeler_version: labelerVersion,
  };
  return {
    source: "sec_8k",
    ticker,
    event_kind: kind,
    event_ts_ms: filing.acceptance_ts_ms,
    available_ts_ms: filing.acceptance_ts_ms,
    score: revisionPct == null ? null : Math.abs(revisionPct),
    payload,
    dedupe_key: `sec_8k_guidance|${labelerVersion}|${filing.accession_path}|${guidanceKey(newFigure)}|${kind}`,
  };
}

export interface GuidanceEventsResult {
  events: Array<EventRecord<GuidanceEventKind>>;
  skips: GuidanceEventSkipCounts;
}

/**
 * Threads one ticker's filings, ordered by acceptance datetime, into guidance
 * revision events. For each (metric, period, unit) it keeps the last committed
 * guide and, when a later filing revises the same outlook, emits a raise or cut
 * scored by the signed percentage change of the midpoints. A first guide is an
 * initiation (no baseline), an unchanged midpoint is a reaffirmation, and a
 * figure with no number withdraws the outlook - a severe cut carrying no
 * synthetic magnitude. All three are counted, never emitted.
 */
export function tickerGuidanceEvents(
  filings: Array<{ filing: CachedFiling; labelSet: StoredLabelSet }>,
  ticker: string,
  labelerVersion: string,
): GuidanceEventsResult {
  const events: Array<EventRecord<GuidanceEventKind>> = [];
  const skips = emptyGuidanceEventSkipCounts();
  const priorByKey = new Map<string, PriorGuide>();

  for (const { filing, labelSet } of filings) {
    for (const figure of filingGuidance(labelSet)) {
      if (!hasStableIdentity(figure)) {
        skips.incomparable += 1;
        continue;
      }
      const key = guidanceKey(figure);
      const prior = priorByKey.get(key);
      const midpoint = guidanceMidpoint(figure);

      if (midpoint == null) {
        if (prior == null) {
          skips.withdrawal_no_prior += 1;
          continue;
        }
        events.push(
          makeEvent(filing, ticker, "guidance_cut", labelerVersion, figure, prior, null, null, true),
        );
        priorByKey.delete(key);
        continue;
      }

      if (prior == null) {
        skips.initiation += 1;
        priorByKey.set(key, { figure, midpoint, accession: filing.accession_path });
        continue;
      }
      if (prior.midpoint === 0) {
        skips.incomparable += 1;
        priorByKey.set(key, { figure, midpoint, accession: filing.accession_path });
        continue;
      }

      const revisionPct = (midpoint - prior.midpoint) / Math.abs(prior.midpoint);
      priorByKey.set(key, { figure, midpoint, accession: filing.accession_path });
      if (revisionPct === 0) {
        skips.reaffirmation += 1;
        continue;
      }
      const kind: GuidanceEventKind = revisionPct > 0 ? "guidance_raise" : "guidance_cut";
      events.push(
        makeEvent(filing, ticker, kind, labelerVersion, figure, prior, midpoint, revisionPct, false),
      );
    }
  }

  return { events, skips };
}
