import type { EventRecord } from "../../types/events.ts";
import type { FilingLabel } from "./eightKLabelSchema.ts";
import type { CachedFiling, StoredLabelSet } from "./eightKLabelStore.ts";

export type FilingEventKind =
  | "filing_guidance_up"
  | "filing_guidance_down"
  | "filing_buyback"
  | "filing_exec_departure";

export interface FilingEventSkipCounts {
  guidance_neutral: number;
  exec_departure_routine: number;
}

export function emptyFilingEventSkipCounts(): FilingEventSkipCounts {
  return { guidance_neutral: 0, exec_departure_routine: 0 };
}

/**
 * The four event kinds are the directional, tradable subset of the labeler's
 * enum. Neutral guidance (initial issuance or reiteration) carries no up/down
 * signal for this source - section 1b's extraction path is where those figures
 * turn into raise/cut events - and a routine departure is precisely the case
 * the 5.02 split exists to drop. Both return null and are counted, never an
 * event.
 */
function labelEventKind(label: FilingLabel): FilingEventKind | null {
  switch (label.kind) {
    case "guidance":
      if (label.direction === "up") return "filing_guidance_up";
      if (label.direction === "down") return "filing_guidance_down";
      return null;
    case "buyback":
      return "filing_buyback";
    case "exec_departure_unplanned":
      return "filing_exec_departure";
    case "exec_departure_routine":
      return null;
  }
}

export interface FilingEventsResult {
  events: Array<EventRecord<FilingEventKind>>;
  skips: FilingEventSkipCounts;
}

/**
 * Maps one filing's cached labels into events. The acceptance datetime is both
 * when the market could act and when the disclosure happened, so event_ts and
 * available_ts are the same instant. score = severity so an evaluation buckets
 * by how materially the labeler judged the event. The dedupe key carries the
 * labeler version and the label's position so re-running is idempotent while a
 * relabel under a new version writes fresh rows that never collide with the old.
 */
export function labelSetToEvents(
  filing: CachedFiling,
  labelSet: StoredLabelSet,
  ticker: string,
): FilingEventsResult {
  const events: Array<EventRecord<FilingEventKind>> = [];
  const skips = emptyFilingEventSkipCounts();

  labelSet.labels.forEach((label, index) => {
    const kind = labelEventKind(label);
    if (kind == null) {
      if (label.kind === "guidance") {
        skips.guidance_neutral += 1;
      } else {
        skips.exec_departure_routine += 1;
      }
      return;
    }
    events.push({
      source: "sec_8k",
      ticker,
      event_kind: kind,
      event_ts_ms: filing.acceptance_ts_ms,
      available_ts_ms: filing.acceptance_ts_ms,
      score: label.severity,
      payload: {
        cik: filing.cik,
        accession: filing.accession_path,
        items: filing.items,
        direction: label.direction,
        severity: label.severity,
        rationale: label.rationale,
        guidance: label.guidance,
        labeler_version: labelSet.labeler_version,
      },
      dedupe_key: `sec_8k|${labelSet.labeler_version}|${filing.accession_path}|${index}|${kind}`,
    });
  });

  return { events, skips };
}
