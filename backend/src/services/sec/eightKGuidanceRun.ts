import { resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { EventRecord } from "../../types/events.ts";
import {
  emptyGuidanceEventSkipCounts,
  tickerGuidanceEvents,
  type GuidanceEventKind,
  type GuidanceEventSkipCounts,
} from "./eightKGuidanceEvents.ts";
import {
  buildTickerMap,
  listCachedFilings,
  readLabelFromVersions,
  type CachedFiling,
  type StoredLabelSet,
} from "./eightKLabelStore.ts";

export interface GuidanceEventsRunResult {
  labeler_versions: string[];
  filings_considered: number;
  filings_labeled: number;
  filings_unlabeled: number;
  filings_without_ticker: number;
  filings_with_guidance: number;
  skips: GuidanceEventSkipCounts;
  events: Array<EventRecord<GuidanceEventKind>>;
}

export interface GuidanceEventsRunOptions {
  /** Precedence order; each filing uses its first version that has a label. */
  labelerVersions: string[];
  cacheDir?: string;
  /** Restrict to filings carrying at least one of these item codes (guidance rides 2.02). */
  items?: string[];
  onProgress?: (message: string) => void;
}

/**
 * Reads only the label cache: it collects every labeled filing, groups them by
 * ticker preserving the global acceptance-datetime order, and hands each ticker's
 * sequence to the extraction pass. No network, no database - the run is a pure
 * function of what is on disk, and INSERT OR IGNORE on the dedupe key makes
 * replaying it a no-op.
 */
export async function collectGuidanceEvents(
  options: GuidanceEventsRunOptions,
): Promise<GuidanceEventsRunResult> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec8k");
  const notify = options.onProgress ?? (() => {});
  const tickerByCik = await buildTickerMap(cacheDir);

  const result: GuidanceEventsRunResult = {
    labeler_versions: options.labelerVersions,
    filings_considered: 0,
    filings_labeled: 0,
    filings_unlabeled: 0,
    filings_without_ticker: 0,
    filings_with_guidance: 0,
    skips: emptyGuidanceEventSkipCounts(),
    events: [],
  };

  const byTicker = new Map<string, Array<{ filing: CachedFiling; labelSet: StoredLabelSet }>>();

  for (const filing of await listCachedFilings(cacheDir)) {
    if (options.items != null && !filing.items.some((item) => options.items?.includes(item))) {
      continue;
    }
    result.filings_considered += 1;

    const labelSet = await readLabelFromVersions(filing.dir, options.labelerVersions);
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
    if (labelSet.labels.some((label) => label.guidance.length > 0)) {
      result.filings_with_guidance += 1;
    }
    const bucket = byTicker.get(ticker) ?? [];
    bucket.push({ filing, labelSet });
    byTicker.set(ticker, bucket);
  }

  for (const [ticker, filings] of byTicker) {
    const mapped = tickerGuidanceEvents(filings, ticker);
    result.skips.initiation += mapped.skips.initiation;
    result.skips.reaffirmation += mapped.skips.reaffirmation;
    result.skips.withdrawal_no_prior += mapped.skips.withdrawal_no_prior;
    result.skips.incomparable += mapped.skips.incomparable;
    result.events.push(...mapped.events);
  }

  return result;
}
