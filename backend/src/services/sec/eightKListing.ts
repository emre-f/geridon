/**
 * 8-K item codes fetched in v1: 2.02 (results-of-operations releases; the
 * attached press release is where guidance lives, feeding TODO-4 section 1b's
 * extraction path) and 5.02 (officer/director departures). Buyback
 * announcements have no dedicated item code — they ride the 7.01/8.01
 * catch-alls — so they wait for a full-text-search discovery path.
 */
export const eightKTargetItems: ReadonlySet<string> = new Set(["2.02", "5.02"]);

const submissionsBaseUrl = "https://data.sec.gov/submissions";

/** Acceptance can land a couple of days after the filing date column used by
 * pagination file ranges; the slack keeps boundary filings discoverable. */
const pageRangeSlackMs = 7 * 86_400_000;

export interface SubmissionColumns {
  accessionNumber: string[];
  filingDate: string[];
  acceptanceDateTime: Array<string | null>;
  form: string[];
  items: Array<string | null>;
  primaryDocument: Array<string | null>;
}

export interface SubmissionsPageRef {
  name: string;
  filingFrom: string;
  filingTo: string;
}

export interface SubmissionsJson {
  cik: string;
  filings: {
    recent: SubmissionColumns;
    files?: SubmissionsPageRef[];
  };
}

export interface EightKFiling {
  accession: string;
  form: string;
  items: string[];
  filed_date: string;
  acceptance_ts_ms: number;
  primary_document: string;
}

export function extractEightKFilings(
  columns: SubmissionColumns,
  fromMs: number,
  toMs: number,
): EightKFiling[] {
  const filings: EightKFiling[] = [];
  for (let index = 0; index < columns.form.length; index += 1) {
    const form = columns.form[index];
    if (form !== "8-K" && form !== "8-K/A") {
      continue;
    }
    const acceptance = columns.acceptanceDateTime[index];
    const acceptanceMs = acceptance == null ? Number.NaN : Date.parse(acceptance);
    if (!(acceptanceMs >= fromMs && acceptanceMs <= toMs)) {
      continue;
    }
    const items = (columns.items[index] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!items.some((item) => eightKTargetItems.has(item))) {
      continue;
    }
    filings.push({
      accession: columns.accessionNumber[index],
      form,
      items,
      filed_date: columns.filingDate[index],
      acceptance_ts_ms: acceptanceMs,
      primary_document: columns.primaryDocument[index] ?? "",
    });
  }
  return filings;
}

/** The recent block covers the newest ~1000 filings; older pagination files
 * are fetched only when their date range overlaps the requested window. */
export function neededPages(
  files: SubmissionsPageRef[],
  fromMs: number,
  toMs: number,
): SubmissionsPageRef[] {
  return files.filter(
    (file) =>
      Date.parse(file.filingTo) + pageRangeSlackMs >= fromMs &&
      Date.parse(file.filingFrom) - pageRangeSlackMs <= toMs,
  );
}

export function submissionsUrl(cik: number): string {
  return `${submissionsBaseUrl}/CIK${String(cik).padStart(10, "0")}.json`;
}

export function submissionsPageUrl(name: string): string {
  return `${submissionsBaseUrl}/${name}`;
}

interface CompanyTickerRow {
  cik_str: number;
  ticker: string;
}

export function buildCikMap(companyTickers: Record<string, CompanyTickerRow>): Map<string, number> {
  const cikByTicker = new Map<string, number>();
  for (const row of Object.values(companyTickers)) {
    cikByTicker.set(row.ticker.toUpperCase(), row.cik_str);
  }
  return cikByTicker;
}
