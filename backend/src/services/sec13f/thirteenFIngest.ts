import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import { getKnownTickers } from "../eventStore.ts";
import { ensureCached } from "./cacheFile.ts";
import { ftdMonthForQuarter, mergeFtdTextIntoMap } from "./cusipTickerMap.ts";
import { createEdgar13fClient, type Edgar13fClient, type ManagerFiling } from "./edgarClient.ts";
import {
  createFilingDiscovery,
  priorQuarter,
  quarterBoundsMs,
  quarterLabel,
  type Quarter,
} from "./filingManifest.ts";
import { parseInfotable, type FilingHoldings } from "./infotableParse.ts";
import { firstPeriodYear, quarterCloseLagDays, valueUnitMultiplier } from "./managers.ts";
import {
  emptySummary,
  ingestQuarter,
  isQuarterIngested,
  type ThirteenFQuarterSummary,
} from "./quarterIngest.ts";

const dayMs = 86_400_000;

/**
 * XML information tables became mandatory in May 2013 (first XML period:
 * 2013-06-30). Diffing needs the prior period in XML too, so the first
 * processable quarter is 2013 Q3.
 */
const firstQuarter: Quarter = { year: 2013, quarter: 3 };

export function closedQuartersInRange(fromYear: number, toYear: number, nowMs: number): Quarter[] {
  const quarters: Quarter[] = [];
  for (let year = Math.max(fromYear, firstPeriodYear); year <= toYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      if (year === firstQuarter.year && quarter < firstQuarter.quarter) {
        continue;
      }
      if (quarterBoundsMs({ year, quarter }).endMs + quarterCloseLagDays * dayMs < nowMs) {
        quarters.push({ year, quarter });
      }
    }
  }
  return quarters;
}

export interface ThirteenFIngestOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  userAgent?: string;
  cacheDir?: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
  /** Tests never provide one and never hit the network: the cache is the fixture. */
  createClient?: () => Edgar13fClient;
}

export async function ingestThirteenF(
  options: ThirteenFIngestOptions,
): Promise<ThirteenFQuarterSummary[]> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec13f");
  const notify = options.onProgress ?? (() => {});

  let client: Edgar13fClient | null = null;
  const getClient = () =>
    (client ??= (options.createClient ??
      (() => {
        if (!options.userAgent) {
          throw new Error("SEC user agent is required for network ingestion.");
        }
        return createEdgar13fClient({ userAgent: options.userAgent });
      }))());

  const holdingsCache = new Map<string, FilingHoldings>();
  const getHoldings = async (cik: number, filing: ManagerFiling): Promise<FilingHoldings> => {
    let holdings = holdingsCache.get(filing.accession);
    if (holdings == null) {
      const xml = await ensureCached(
        join(cacheDir, "infotables", `${filing.accession.replaceAll("-", "")}.xml`),
        () => {
          notify(`fetching information table ${filing.accession}`);
          return getClient().fetchInfotableXml(cik, filing.accession);
        },
      );
      holdings = parseInfotable(xml, valueUnitMultiplier(filing.acceptance_ms));
      holdingsCache.set(filing.accession, holdings);
    }
    return holdings;
  };

  const quarters = closedQuartersInRange(
    options.fromYear,
    options.toYear,
    options.nowMs ?? Date.now(),
  );
  let cusipToTicker: Map<string, string> | null = null;
  const getCusipMap = async (): Promise<Map<string, string>> =>
    (cusipToTicker ??= await buildCusipMap(quarters, cacheDir, getClient, notify));

  const context = {
    cacheDir,
    knownTickers: getKnownTickers(options.db),
    discover: createFilingDiscovery(getClient),
    getHoldings,
    getCusipMap,
    notify,
  };

  const summaries: ThirteenFQuarterSummary[] = [];
  for (const quarter of quarters) {
    if (isQuarterIngested(options.db, quarter)) {
      notify(`${quarterLabel(quarter)}: already ingested, skipping`);
      summaries.push({ ...emptySummary(quarterLabel(quarter)), status: "already_ingested" });
      continue;
    }
    summaries.push(await ingestQuarter(options.db, quarter, context));
  }
  return summaries;
}

/**
 * Latest-file-wins across one fails-to-deliver file per quarter in range (plus
 * one before it, for exits out of the earliest prior filing), so each CUSIP
 * maps to its most recent symbol — the identity the candles table uses.
 */
async function buildCusipMap(
  quarters: Quarter[],
  cacheDir: string,
  getClient: () => Edgar13fClient,
  notify: (message: string) => void,
): Promise<Map<string, string>> {
  const months = new Set<string>();
  if (quarters.length > 0) {
    const prior = priorQuarter(quarters[0]);
    months.add(ftdMonthForQuarter(prior.year, prior.quarter));
  }
  for (const quarter of quarters) {
    months.add(ftdMonthForQuarter(quarter.year, quarter.quarter));
  }

  const map = new Map<string, string>();
  for (const month of [...months].sort()) {
    const path = join(cacheDir, "ftd", `cnsfails${month}a.txt`);
    if (!existsSync(path)) {
      notify(`fetching fails-to-deliver file for ${month}`);
      const text = await getClient().fetchFtdText(month);
      if (text == null) {
        notify(`${month}: fails-to-deliver file not published, skipping`);
        continue;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.partial`, text);
      await rename(`${path}.partial`, path);
    }
    mergeFtdTextIntoMap(await readFile(path, "utf8"), map);
  }
  return map;
}
