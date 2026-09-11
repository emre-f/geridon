import { getSettings } from "../../config.ts";
import { createDb, openDatabase } from "../../db.ts";
import {
  fetchEightKFilings,
  firstEightKItemYear,
  type EightKFetchSummary,
} from "./eightKFetch.ts";

/** Candle coverage starts 2016; earlier filings would be unevaluable text. */
const defaultFromYear = 2016;

function optionValue(args: string[], prefix: string, fallback: string): string {
  const option = args.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function parseYear(raw: string, nowYear: number): number {
  if (raw === "now") {
    return nowYear;
  }
  const year = Number(raw);
  if (!Number.isInteger(year) || year < firstEightKItemYear || year > nowYear) {
    throw new Error(`Invalid year "${raw}" (expected ${firstEightKItemYear}..${nowYear} or "now").`);
  }
  return year;
}

export async function runFetchEightK(args: string[]): Promise<void> {
  const settings = getSettings();
  if (!settings.secUserAgent) {
    throw new Error(
      "SEC_USER_AGENT is not configured. SEC requires a declared contact on every request; " +
        'set it in backend/.env, e.g. SEC_USER_AGENT="geridon/0.1 you@example.com".',
    );
  }

  const nowYear = new Date().getUTCFullYear();
  const fromYear = parseYear(optionValue(args, "--from=", String(defaultFromYear)), nowYear);
  const toYear = parseYear(optionValue(args, "--to=", "now"), nowYear);
  if (fromYear > toYear) {
    throw new Error("--from must not be after --to.");
  }
  const tickersRaw = optionValue(args, "--tickers=", "");
  const tickers = tickersRaw
    ? tickersRaw.split(",").map((ticker) => ticker.trim()).filter((ticker) => ticker.length > 0)
    : undefined;

  const db = openDatabase(settings.databaseUrl);
  createDb(db);

  const summary = await fetchEightKFilings({
    db,
    fromYear,
    toYear,
    userAgent: settings.secUserAgent,
    tickers,
    onProgress: (message) => console.log(message),
  });
  printReport(summary);
}

function printReport(summary: EightKFetchSummary): void {
  console.log(
    `\nTickers: ${summary.tickers} in universe, ${summary.tickers_without_cik.length} without a CIK mapping`,
  );
  if (summary.tickers_without_cik.length > 0) {
    console.log(`  no CIK: ${summary.tickers_without_cik.join(", ")}`);
  }
  console.log(
    `Listings: ${summary.listings_fetched} fetched, ${summary.listings_cached} cached`,
  );
  console.log(
    `Filings: ${summary.filings} matched, ${summary.filings_fetched} fetched, ` +
      `${summary.filings_cached} cached`,
  );
  console.log(
    `Documents: ${summary.documents_fetched} fetched, ${summary.missing_documents} missing on EDGAR`,
  );
  console.log("\nFilings per year:");
  for (const year of Object.keys(summary.filings_per_year).sort()) {
    console.log(`  ${year}  ${summary.filings_per_year[year]}`);
  }
}
