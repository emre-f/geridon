import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { backendRoot } from "../../config.ts";
import type { Database } from "../../db.ts";
import { getKnownTickers } from "../eventStore.ts";
import { createEdgarClient, type EdgarClient } from "./edgarClient.ts";
import { ensureCached, ensureFilingDocuments, type FetchCounters } from "./eightKFilingCache.ts";
import {
  buildCikMap,
  extractEightKFilings,
  neededPages,
  submissionsPageUrl,
  submissionsUrl,
  type EightKFiling,
  type SubmissionColumns,
  type SubmissionsJson,
} from "./eightKListing.ts";

/** The current 8-K item numbering (2.02, 5.02, ...) exists since August 2004. */
export const firstEightKItemYear = 2004;
const companyTickersUrl = "https://www.sec.gov/files/company_tickers.json";
const dayMs = 86_400_000;

/** Wall-time is round-trip bound; the client throttle owns the request rate. */
const filingConcurrency = 6;

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

interface TickerListing {
  ticker: string;
  cik: number;
  from_ms: number;
  to_ms: number;
  filings: EightKFiling[];
}

export interface EightKFetchSummary extends FetchCounters {
  tickers: number;
  tickers_without_cik: string[];
  listings_fetched: number;
  listings_cached: number;
  filings: number;
  filings_per_year: Record<string, number>;
}

export interface EightKFetchOptions {
  db: Database;
  fromYear: number;
  toYear: number;
  userAgent: string;
  tickers?: string[];
  cacheDir?: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
  /** Tests provide a fake; the cache is the fixture and stays off the network. */
  createClient?: (userAgent: string) => EdgarClient;
}

export async function fetchEightKFilings(options: EightKFetchOptions): Promise<EightKFetchSummary> {
  const cacheDir = options.cacheDir ?? resolve(backendRoot, "data/raw/sec8k");
  const notify = options.onProgress ?? (() => {});
  const nowMs = options.nowMs ?? Date.now();
  const fromMs = Date.UTC(options.fromYear, 0, 1);
  const endOfYesterdayMs = Math.floor(nowMs / dayMs) * dayMs - 1;
  const toMs = Math.min(Date.UTC(options.toYear + 1, 0, 1) - 1, endOfYesterdayMs);

  let client: EdgarClient | null = null;
  const getClient = () =>
    (client ??= (options.createClient ?? createEdgarClient)(options.userAgent));

  const universe = (options.tickers ?? [...getKnownTickers(options.db)])
    .map((ticker) => ticker.toUpperCase())
    .sort();

  const cikMapJson = await ensureCached(join(cacheDir, "company_tickers.json"), async () => {
    notify("fetching company_tickers.json");
    return JSON.stringify(await getClient().fetchJson(companyTickersUrl));
  });
  const cikByTicker = buildCikMap(JSON.parse(cikMapJson));

  const summary = emptySummary();
  summary.tickers = universe.length;
  const processedAccessions = new Set<string>();

  for (const ticker of universe) {
    const cik = cikByTicker.get(ticker);
    if (cik == null) {
      summary.tickers_without_cik.push(ticker);
      continue;
    }
    const listing = await ensureListing(cacheDir, ticker, cik, fromMs, toMs, getClient, summary, notify);
    const pending: EightKFiling[] = [];
    for (const filing of listing.filings) {
      if (filing.acceptance_ts_ms < fromMs || filing.acceptance_ts_ms > toMs) {
        continue;
      }
      const accessionKey = `${cik}/${filing.accession}`;
      if (processedAccessions.has(accessionKey)) {
        continue;
      }
      processedAccessions.add(accessionKey);
      summary.filings += 1;
      const year = filing.filed_date.slice(0, 4);
      summary.filings_per_year[year] = (summary.filings_per_year[year] ?? 0) + 1;
      pending.push(filing);
    }
    let fetched = 0;
    await runWithConcurrency(pending, filingConcurrency, async (filing) => {
      if (await ensureFilingDocuments(cacheDir, cik, filing, getClient, summary)) {
        fetched += 1;
      }
    });
    notify(`${ticker}: ${pending.length} filings, ${fetched} fetched`);
  }

  summary.tickers_without_cik.sort();
  return summary;
}

function emptySummary(): EightKFetchSummary {
  return {
    tickers: 0,
    tickers_without_cik: [],
    listings_fetched: 0,
    listings_cached: 0,
    filings: 0,
    filings_fetched: 0,
    filings_cached: 0,
    documents_fetched: 0,
    missing_documents: 0,
    filings_per_year: {},
  };
}

async function ensureListing(
  cacheDir: string,
  ticker: string,
  cik: number,
  fromMs: number,
  toMs: number,
  getClient: () => EdgarClient,
  summary: EightKFetchSummary,
  notify: (message: string) => void,
): Promise<TickerListing> {
  const listingPath = join(cacheDir, "listings", `${ticker}.json`);
  if (existsSync(listingPath)) {
    const cached = JSON.parse(await readFile(listingPath, "utf8")) as TickerListing;
    if (cached.from_ms <= fromMs && cached.to_ms >= toMs) {
      summary.listings_cached += 1;
      return cached;
    }
  }

  notify(`${ticker}: listing 8-K filings`);
  const submissions = await getClient().fetchJson<SubmissionsJson>(submissionsUrl(cik));
  const filings = extractEightKFilings(submissions.filings.recent, fromMs, toMs);
  for (const page of neededPages(submissions.filings.files ?? [], fromMs, toMs)) {
    const columns = await getClient().fetchJson<SubmissionColumns>(submissionsPageUrl(page.name));
    filings.push(...extractEightKFilings(columns, fromMs, toMs));
  }
  filings.sort(
    (left, right) =>
      left.acceptance_ts_ms - right.acceptance_ts_ms ||
      left.accession.localeCompare(right.accession),
  );

  const listing: TickerListing = { ticker, cik, from_ms: fromMs, to_ms: toMs, filings };
  await mkdir(dirname(listingPath), { recursive: true });
  await writeFile(listingPath, JSON.stringify(listing));
  summary.listings_fetched += 1;
  return listing;
}
