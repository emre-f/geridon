import type { EventRecord } from "../../types/events.ts";
import { endOfDayUtcMs } from "../sec/secTsv.ts";
import { parseUsDateMs, type PtrFiling, type PtrTransactionRow } from "./ptrParse.ts";

/**
 * Fixed at ingestion, never optimized: a disclosure is "prompt" when it lands
 * within this many calendar days of the trade. The STOCK Act allows up to 45;
 * evaluation-time filters on disclosure_lag_days handle every other cut.
 */
export const PROMPT_DISCLOSURE_MAX_LAG_DAYS = 14;

const dayMs = 86_400_000;

export interface CongressSkipCounts {
  non_stock: number;
  non_trade_type: number;
  missing_ticker: number;
  invalid_dates: number;
  invalid_amount: number;
  point_in_time_violations: number;
}

export function emptyCongressSkipCounts(): CongressSkipCounts {
  return {
    non_stock: 0,
    non_trade_type: 0,
    missing_ticker: 0,
    invalid_dates: 0,
    invalid_amount: 0,
    point_in_time_violations: 0,
  };
}

export interface AmountRange {
  low: number;
  high: number | null;
}

/** Ranges look like "$1,001 - $15,000" or, at the top, "Over $50,000,000". */
export function parseAmountRange(raw: string): AmountRange | null {
  const bounded = /^\$([\d,]+)\s*-\s*\$([\d,]+)$/.exec(raw.trim());
  if (bounded) {
    const low = Number(bounded[1].replaceAll(",", ""));
    const high = Number(bounded[2].replaceAll(",", ""));
    return low > 0 && high > low ? { low, high } : null;
  }
  const unbounded = /^Over\s+\$([\d,]+)$/i.exec(raw.trim());
  if (unbounded) {
    const low = Number(unbounded[1].replaceAll(",", ""));
    return low > 0 ? { low, high: null } : null;
  }
  return null;
}

const tradeTypeByLabel: Record<string, "purchase" | "sale_full" | "sale_partial"> = {
  Purchase: "purchase",
  "Sale (Full)": "sale_full",
  "Sale (Partial)": "sale_partial",
};

const missingTickerValues = new Set(["", "--", "N/A", "NONE"]);

export type NormalizePtrResult =
  | { event: EventRecord<"congress_buy" | "congress_sell"> }
  | { skip: keyof CongressSkipCounts };

/**
 * available_ts is the disclosure filing date (end of day UTC), never the trade
 * date — the up-to-45-day gap between them is exactly where fake alpha hides.
 * Score = log10 of the amount-range midpoint (the range low when the top range
 * has no upper bound). The dedupe key is transaction identity, so an amendment
 * re-filing the same trades lands as duplicates instead of double-counting.
 */
export function normalizePtrTransaction(
  filing: PtrFiling,
  row: PtrTransactionRow,
): NormalizePtrResult {
  if (row.asset_type !== "Stock") {
    return { skip: "non_stock" };
  }
  const tradeType = tradeTypeByLabel[row.transaction_type];
  if (tradeType == null) {
    return { skip: "non_trade_type" };
  }
  const ticker = row.ticker.toUpperCase().trim();
  if (missingTickerValues.has(ticker)) {
    return { skip: "missing_ticker" };
  }

  const tradeDateMs = parseUsDateMs(row.transaction_date);
  if (tradeDateMs == null) {
    return { skip: "invalid_dates" };
  }
  const availableTsMs = endOfDayUtcMs(filing.filed_date_ms);
  if (availableTsMs < tradeDateMs) {
    return { skip: "point_in_time_violations" };
  }
  const disclosureLagDays = Math.round((filing.filed_date_ms - tradeDateMs) / dayMs);

  const amount = parseAmountRange(row.amount);
  if (amount == null) {
    return { skip: "invalid_amount" };
  }
  const scoreBasis = amount.high == null ? amount.low : (amount.low + amount.high) / 2;

  const tradeDay = new Date(tradeDateMs).toISOString().slice(0, 10);
  const member = filing.member.replace(/\s+/g, " ").trim();
  const dedupeKey = [
    "senate_efd",
    member.toUpperCase(),
    ticker,
    tradeDay,
    tradeType,
    amount.low,
    row.owner,
  ].join(":");

  return {
    event: {
      source: "senate_efd",
      ticker,
      event_kind: tradeType === "purchase" ? "congress_buy" : "congress_sell",
      event_ts_ms: tradeDateMs,
      available_ts_ms: availableTsMs,
      score: Math.log10(scoreBasis),
      payload: {
        member,
        chamber: "senate",
        owner: row.owner,
        transaction_type: tradeType,
        asset_name: row.asset_name,
        amount_low: amount.low,
        amount_high: amount.high,
        reported_trade_date: tradeDay,
        disclosure_lag_days: disclosureLagDays,
        prompt_disclosure: disclosureLagDays <= PROMPT_DISCLOSURE_MAX_LAG_DAYS,
      },
      dedupe_key: dedupeKey,
    },
  };
}
