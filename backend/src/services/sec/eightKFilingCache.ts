import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { EdgarClient } from "./edgarClient.ts";
import {
  accessionPath,
  indexHeadersUrl,
  filingFileUrl,
  parseDocumentManifest,
  selectDocumentFiles,
} from "./eightKDocs.ts";
import type { EightKFiling } from "./eightKListing.ts";

export interface FetchCounters {
  filings_fetched: number;
  filings_cached: number;
  documents_fetched: number;
  missing_documents: number;
}

/** Cached files are the unit of work; a cache hit never touches the network. */
export async function ensureCached(
  path: string,
  fetchContent: () => Promise<string>,
): Promise<string> {
  if (existsSync(path)) {
    return readFile(path, "utf8");
  }
  const content = await fetchContent();
  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, content);
  await rename(partialPath, path);
  return content;
}

/** documents.json is written last, so its presence marks the filing complete. */
export async function ensureFilingDocuments(
  cacheDir: string,
  cik: number,
  filing: EightKFiling,
  getClient: () => EdgarClient,
  counters: FetchCounters,
): Promise<boolean> {
  const filingDir = join(cacheDir, "filings", String(cik), accessionPath(filing.accession));
  const recordPath = join(filingDir, "documents.json");
  if (existsSync(recordPath)) {
    counters.filings_cached += 1;
    return false;
  }

  const manifestHtml = await ensureDocument(
    filingDir,
    "index-headers.html",
    () => getClient().fetchText(indexHeadersUrl(cik, filing.accession)),
    counters,
  );
  const manifest = manifestHtml == null ? [] : parseDocumentManifest(manifestHtml);
  const { primary, exhibits } = selectDocumentFiles(manifest, filing.primary_document);

  const missing: string[] = manifestHtml == null ? ["index-headers.html"] : [];
  for (const filename of [primary, ...exhibits]) {
    if (filename == null) {
      continue;
    }
    const content = await ensureDocument(
      filingDir,
      filename.replaceAll("/", "_"),
      () => getClient().fetchText(filingFileUrl(cik, filing.accession, filename)),
      counters,
    );
    if (content == null) {
      missing.push(filename);
    }
  }

  const record = {
    form: filing.form,
    items: filing.items,
    filed_date: filing.filed_date,
    acceptance_ts_ms: filing.acceptance_ts_ms,
    primary,
    exhibits,
    missing,
  };
  await writeFile(`${recordPath}.partial`, JSON.stringify(record));
  await rename(`${recordPath}.partial`, recordPath);
  counters.filings_fetched += 1;
  return true;
}

/** A 404 writes a .missing marker so re-runs never re-request dead documents. */
async function ensureDocument(
  filingDir: string,
  localName: string,
  fetchContent: () => Promise<string | null>,
  counters: FetchCounters,
): Promise<string | null> {
  const path = join(filingDir, localName);
  if (existsSync(path)) {
    return readFile(path, "utf8");
  }
  if (existsSync(`${path}.missing`)) {
    return null;
  }
  const content = await fetchContent();
  await mkdir(filingDir, { recursive: true });
  if (content == null) {
    await writeFile(`${path}.missing`, "");
    counters.missing_documents += 1;
    return null;
  }
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, content);
  await rename(partialPath, path);
  counters.documents_fetched += 1;
  return content;
}
