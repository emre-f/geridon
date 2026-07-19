import type { EventRecord, InstitutionalStakePayload } from "../../types/events.ts";
import type { ManagerFiling } from "./edgarClient.ts";
import type { FilingHoldings, Holding } from "./infotableParse.ts";
import type { CuratedManager } from "./managers.ts";

const dayMs = 86_400_000;

export interface ThirteenFSkipCounts {
  option_rows: number;
  principal_rows: number;
  malformed_rows: number;
  unmapped_cusip_rows: number;
  empty_filings: number;
}

export function emptyThirteenFSkipCounts(): ThirteenFSkipCounts {
  return {
    option_rows: 0,
    principal_rows: 0,
    malformed_rows: 0,
    unmapped_cusip_rows: 0,
    empty_filings: 0,
  };
}

export interface ManagerQuarterDiff {
  events: Array<EventRecord<"inst_new_stake" | "inst_exit">>;
  skips: ThirteenFSkipCounts;
  unmapped_cusips: Set<string>;
}

export function periodEndOfDayMs(period: string): number {
  const [year, month, day] = period.split("-").map(Number);
  return Date.UTC(year, month - 1, day) + dayMs - 1;
}

export interface ManagerQuarterInput {
  manager: CuratedManager;
  current: { filing: ManagerFiling; holdings: FilingHoldings };
  prior: { filing: ManagerFiling; holdings: FilingHoldings };
  cusipToTicker: Map<string, string>;
}

/**
 * Diffs two consecutive quarterly filings into inst_new_stake / inst_exit
 * events. The score is the position's share of that filing's long-equity book,
 * so "conviction size" filters are evaluation-time score filters, not
 * ingestion knobs.
 */
export function diffManagerQuarter(input: ManagerQuarterInput): ManagerQuarterDiff {
  const { manager, current, prior, cusipToTicker } = input;
  const result: ManagerQuarterDiff = {
    events: [],
    skips: emptyThirteenFSkipCounts(),
    unmapped_cusips: new Set(),
  };

  for (const side of [current.holdings, prior.holdings]) {
    result.skips.option_rows += side.option_rows;
    result.skips.principal_rows += side.principal_rows;
    result.skips.malformed_rows += side.malformed_rows;
  }
  if (current.holdings.total_value_usd <= 0 || prior.holdings.total_value_usd <= 0) {
    result.skips.empty_filings += 1;
    return result;
  }

  const addEvent = (
    kind: "inst_new_stake" | "inst_exit",
    holding: Holding,
    totalValueUsd: number,
  ) => {
    const ticker = cusipToTicker.get(holding.cusip);
    if (ticker == null) {
      result.skips.unmapped_cusip_rows += 1;
      result.unmapped_cusips.add(holding.cusip);
      return;
    }
    const periodEndMs = periodEndOfDayMs(current.filing.period);
    const payload: InstitutionalStakePayload = {
      manager: manager.name,
      cik: manager.cik,
      period: current.filing.period,
      prior_period: prior.filing.period,
      cusip: holding.cusip,
      issuer_name: holding.issuer_name,
      value_usd: holding.value_usd,
      shares: holding.shares,
      portfolio_share: holding.value_usd / totalValueUsd,
      portfolio_total_usd: totalValueUsd,
      filing_lag_days: Math.floor(
        (current.filing.acceptance_ms - periodEndMs) / dayMs,
      ),
    };
    result.events.push({
      source: "sec_13f",
      ticker,
      event_kind: kind,
      event_ts_ms: periodEndMs,
      available_ts_ms: current.filing.acceptance_ms,
      score: payload.portfolio_share,
      payload,
      dedupe_key: `13f|${manager.cik}|${current.filing.period}|${holding.cusip}|${kind}`,
    });
  };

  for (const [cusip, holding] of current.holdings.holdings) {
    if (!prior.holdings.holdings.has(cusip)) {
      addEvent("inst_new_stake", holding, current.holdings.total_value_usd);
    }
  }
  for (const [cusip, holding] of prior.holdings.holdings) {
    if (!current.holdings.holdings.has(cusip)) {
      addEvent("inst_exit", holding, prior.holdings.total_value_usd);
    }
  }
  return result;
}
