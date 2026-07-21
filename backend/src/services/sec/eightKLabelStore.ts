import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FilingLabelSet } from "./eightKLabelSchema.ts";
import { assembleFilingText, documentToText, type FilingTextPart } from "./eightKText.ts";

export interface CachedFiling {
  cik: number;
  accession_path: string;
  dir: string;
  form: string;
  items: string[];
  filed_date: string;
  acceptance_ts_ms: number;
  primary: string | null;
  exhibits: string[];
}

export interface StoredLabelSet extends FilingLabelSet {
  labeler_version: string;
  labeled_at: string;
}

/**
 * Labels live beside the filing they describe, one directory per labeler
 * version, so relabeling under a new prompt or model never overwrites the old
 * rows and no evaluation can mix versions by accident.
 */
export function labelPath(filingDir: string, labelerVersion: string): string {
  return join(filingDir, "labels", `${labelerVersion}.json`);
}

export function hasLabel(filingDir: string, labelerVersion: string): boolean {
  return existsSync(labelPath(filingDir, labelerVersion));
}

export async function readLabel(
  filingDir: string,
  labelerVersion: string,
): Promise<StoredLabelSet | null> {
  const path = labelPath(filingDir, labelerVersion);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as StoredLabelSet;
}

export async function writeLabel(
  filingDir: string,
  labelerVersion: string,
  labels: FilingLabelSet,
  nowIso: string,
): Promise<void> {
  const path = labelPath(filingDir, labelerVersion);
  await mkdir(dirname(path), { recursive: true });
  const stored: StoredLabelSet = {
    ...labels,
    labeler_version: labelerVersion,
    labeled_at: nowIso,
  };
  await writeFile(`${path}.partial`, JSON.stringify(stored));
  await rename(`${path}.partial`, path);
}

interface DocumentsRecord {
  form: string;
  items: string[];
  filed_date: string;
  acceptance_ts_ms: number;
  primary: string | null;
  exhibits: string[];
}

/**
 * Walks the fetch cache rather than a database: `documents.json` is written
 * last by the fetcher, so its presence is what marks a filing complete enough
 * to label.
 */
export async function listCachedFilings(cacheDir: string): Promise<CachedFiling[]> {
  const filingsRoot = join(cacheDir, "filings");
  if (!existsSync(filingsRoot)) {
    return [];
  }

  const filings: CachedFiling[] = [];
  for (const cikEntry of await readdir(filingsRoot, { withFileTypes: true })) {
    if (!cikEntry.isDirectory()) {
      continue;
    }
    const cikDir = join(filingsRoot, cikEntry.name);
    for (const accessionEntry of await readdir(cikDir, { withFileTypes: true })) {
      if (!accessionEntry.isDirectory()) {
        continue;
      }
      const dir = join(cikDir, accessionEntry.name);
      const recordPath = join(dir, "documents.json");
      if (!existsSync(recordPath)) {
        continue;
      }
      const record = JSON.parse(await readFile(recordPath, "utf8")) as DocumentsRecord;
      filings.push({
        cik: Number(cikEntry.name),
        accession_path: accessionEntry.name,
        dir,
        form: record.form,
        items: record.items ?? [],
        filed_date: record.filed_date,
        acceptance_ts_ms: record.acceptance_ts_ms,
        primary: record.primary,
        exhibits: record.exhibits ?? [],
      });
    }
  }

  filings.sort(
    (left, right) =>
      left.acceptance_ts_ms - right.acceptance_ts_ms ||
      left.accession_path.localeCompare(right.accession_path),
  );
  return filings;
}

export async function readFilingText(filing: CachedFiling): Promise<string> {
  const readPart = async (filename: string): Promise<FilingTextPart | null> => {
    const path = join(filing.dir, filename.replaceAll("/", "_"));
    if (!existsSync(path)) {
      return null;
    }
    return { filename, text: documentToText(await readFile(path, "utf8")) };
  };

  const primary = filing.primary == null ? null : await readPart(filing.primary);
  const exhibits: FilingTextPart[] = [];
  for (const exhibit of filing.exhibits) {
    const part = await readPart(exhibit);
    if (part != null) {
      exhibits.push(part);
    }
  }
  return assembleFilingText(primary, exhibits);
}

/** Listings are keyed by ticker; share classes on one CIK keep the first seen. */
export async function buildTickerMap(cacheDir: string): Promise<Map<number, string>> {
  const listingsDir = join(cacheDir, "listings");
  const tickerByCik = new Map<number, string>();
  if (!existsSync(listingsDir)) {
    return tickerByCik;
  }
  for (const entry of await readdir(listingsDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const listing = JSON.parse(await readFile(join(listingsDir, entry), "utf8")) as {
      ticker: string;
      cik: number;
    };
    if (!tickerByCik.has(listing.cik)) {
      tickerByCik.set(listing.cik, listing.ticker);
    }
  }
  return tickerByCik;
}
