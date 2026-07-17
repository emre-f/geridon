import type { EventRecord } from "../../types/events.ts";
import { endOfDayUtcMs, parseSecDateMs, type TsvRecord } from "./secTsv.ts";

/**
 * Fixed at ingestion, never optimized: score = log10(dollar value), plus this
 * bonus when any reporting owner is an officer.
 */
export const OFFICER_SCORE_BONUS = 0.5;

const missingTickerValues = new Set(["", "NONE", "N/A", "NA"]);

/** Real feeds contain "(CALX)", "-", "none", "N/A" where a symbol should be. */
function cleanTicker(raw: string): string | null {
  let symbol = raw.toUpperCase().trim();
  const wrapped = /^\((.+)\)$/.exec(symbol);
  if (wrapped) {
    symbol = wrapped[1].trim();
  }
  if (missingTickerValues.has(symbol) || /^-+$/.test(symbol)) {
    return null;
  }
  return symbol;
}

export interface SubmissionInfo {
  issuer_cik: string;
  ticker: string | null;
  filing_date_ms: number | null;
}

export interface OwnerInfo {
  ciks: string[];
  names: string[];
  is_officer: boolean;
  is_director: boolean;
  is_ten_percent_owner: boolean;
}

export interface Form4SkipCounts {
  non_open_market: number;
  missing_submission: number;
  missing_owner: number;
  missing_ticker: number;
  invalid_dates: number;
  invalid_shares: number;
  point_in_time_violations: number;
}

export function emptySkipCounts(): Form4SkipCounts {
  return {
    non_open_market: 0,
    missing_submission: 0,
    missing_owner: 0,
    missing_ticker: 0,
    invalid_dates: 0,
    invalid_shares: 0,
    point_in_time_violations: 0,
  };
}

export async function buildSubmissionIndex(
  rows: AsyncIterable<TsvRecord>,
): Promise<Map<string, SubmissionInfo>> {
  const index = new Map<string, SubmissionInfo>();
  for await (const row of rows) {
    index.set(row.ACCESSION_NUMBER, {
      issuer_cik: row.ISSUERCIK,
      ticker: cleanTicker(row.ISSUERTRADINGSYMBOL),
      filing_date_ms: parseSecDateMs(row.FILING_DATE),
    });
  }
  return index;
}

export async function buildOwnerIndex(
  rows: AsyncIterable<TsvRecord>,
): Promise<Map<string, OwnerInfo>> {
  const index = new Map<string, OwnerInfo>();
  for await (const row of rows) {
    const owner = index.get(row.ACCESSION_NUMBER) ?? {
      ciks: [],
      names: [],
      is_officer: false,
      is_director: false,
      is_ten_percent_owner: false,
    };
    owner.ciks.push(row.RPTOWNERCIK);
    owner.names.push(row.RPTOWNERNAME);
    const roles = row.RPTOWNER_RELATIONSHIP.split(",").map((role) => role.trim());
    owner.is_officer ||= roles.includes("Officer");
    owner.is_director ||= roles.includes("Director");
    owner.is_ten_percent_owner ||= roles.includes("TenPercentOwner");
    index.set(row.ACCESSION_NUMBER, owner);
  }
  return index;
}

export type NormalizeResult =
  | { event: EventRecord<"insider_buy" | "insider_sell"> }
  | { skip: keyof Form4SkipCounts };

/**
 * The dedupe key is built from transaction identity (issuer, owners, date,
 * code, shares, price), not the accession number: an amendment (4/A) re-files
 * the same transactions under a new accession, and identity keys make the
 * re-filed rows land as duplicates instead of double-counted events. Two
 * genuinely distinct same-day lots with identical shares and price collapse
 * into one event; that undercount is accepted and disclosed.
 */
export function normalizeTransaction(
  row: TsvRecord,
  submissions: Map<string, SubmissionInfo>,
  owners: Map<string, OwnerInfo>,
): NormalizeResult {
  const code = row.TRANS_CODE;
  if (code !== "P" && code !== "S") {
    return { skip: "non_open_market" };
  }
  const submission = submissions.get(row.ACCESSION_NUMBER);
  if (!submission) {
    return { skip: "missing_submission" };
  }
  if (submission.ticker == null) {
    return { skip: "missing_ticker" };
  }
  const owner = owners.get(row.ACCESSION_NUMBER);
  if (!owner) {
    return { skip: "missing_owner" };
  }

  const transactionDateMs = parseSecDateMs(row.TRANS_DATE);
  if (transactionDateMs == null || submission.filing_date_ms == null) {
    return { skip: "invalid_dates" };
  }
  const availableTsMs = endOfDayUtcMs(submission.filing_date_ms);
  if (availableTsMs < transactionDateMs) {
    return { skip: "point_in_time_violations" };
  }

  const shares = Number(row.TRANS_SHARES);
  if (!Number.isFinite(shares) || row.TRANS_SHARES === "" || shares <= 0) {
    return { skip: "invalid_shares" };
  }
  const priceRaw = Number(row.TRANS_PRICEPERSHARE);
  const price =
    row.TRANS_PRICEPERSHARE !== "" && Number.isFinite(priceRaw) && priceRaw > 0
      ? priceRaw
      : null;
  const dollarValue = price == null ? null : shares * price;
  const score =
    dollarValue == null
      ? null
      : Math.log10(dollarValue) + (owner.is_officer ? OFFICER_SCORE_BONUS : 0);

  const transactionDay = new Date(transactionDateMs).toISOString().slice(0, 10);
  const ownerCiks = [...owner.ciks].sort().join("+");
  const dedupeKey = `sec_form4:${submission.issuer_cik}:${ownerCiks}:${transactionDay}:${code}:${shares}:${price ?? ""}`;

  return {
    event: {
      source: "sec_form4",
      ticker: submission.ticker,
      event_kind: code === "P" ? "insider_buy" : "insider_sell",
      event_ts_ms: transactionDateMs,
      available_ts_ms: availableTsMs,
      score,
      payload: {
        insider_name: [...owner.names].sort().join("; "),
        is_officer: owner.is_officer,
        is_director: owner.is_director,
        is_ten_percent_owner: owner.is_ten_percent_owner,
        shares,
        price,
        dollar_value: dollarValue,
      },
      dedupe_key: dedupeKey,
    },
  };
}
