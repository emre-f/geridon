import { resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { EventRecord } from "../../types/events.ts";
import {
  emptyFilingEventSkipCounts,
  labelSetToEvents,
  type FilingEventKind,
  type FilingEventSkipCounts,
} from "./eightKLabelEvents.ts";
import { buildTickerMap, listCachedFilings, readLabel } from "./eightKLabelStore.ts";

export interface FilingEventsRunResult {
  labeler_version: string;
  filings_considered: number;
  filings_labeled: number;
  filings_unlabeled: number;
  filings_without_ticker: number;
  skips: FilingEventSkipCounts;
  events: Array<EventRecord<FilingEventKind>>;
}

export interface FilingEventsRunOptions {
  labelerVersion: string;
  cacheDir?: string;
  /** Restrict to filings that carry at least one of these 8-K item codes. */
  items?: string[];
  onProgress?: (message: string) => void;
}

/**
 * Walks the label cache for one pinned labeler version and turns every labeled
 * filing into events. It never touches the database or the network: the cache
 * is the sole input, so the same run is a pure function of what is on disk and
 * `INSERT OR IGNORE` on the dedupe key makes replaying it idempotent.
 */
export async function collectFilingEvents(
  options: FilingEventsRunOptions,
): Promise<FilingEventsRunResult> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec8k");
  const notify = options.onProgress ?? (() => {});
  const tickerByCik = await buildTickerMap(cacheDir);

  const result: FilingEventsRunResult = {
    labeler_version: options.labelerVersion,
    filings_considered: 0,
    filings_labeled: 0,
    filings_unlabeled: 0,
    filings_without_ticker: 0,
    skips: emptyFilingEventSkipCounts(),
    events: [],
  };

  for (const filing of await listCachedFilings(cacheDir)) {
    if (options.items != null && !filing.items.some((item) => options.items?.includes(item))) {
      continue;
    }
    result.filings_considered += 1;

    const labelSet = await readLabel(filing.dir, options.labelerVersion);
    if (labelSet == null) {
      result.filings_unlabeled += 1;
      continue;
    }
    const ticker = tickerByCik.get(filing.cik);
    if (ticker == null) {
      result.filings_without_ticker += 1;
      notify(`${filing.accession_path}: no ticker for CIK ${filing.cik}, skipping`);
      continue;
    }

    result.filings_labeled += 1;
    const mapped = labelSetToEvents(filing, labelSet, ticker);
    result.skips.guidance_neutral += mapped.skips.guidance_neutral;
    result.skips.exec_departure_routine += mapped.skips.exec_departure_routine;
    result.events.push(...mapped.events);
  }

  return result;
}
