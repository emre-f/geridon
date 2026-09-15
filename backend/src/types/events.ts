import type { GuidanceFigure, LabelDirection } from "../services/sec/eightKLabelSchema.ts";

export type EventSourceId =
  | "sec_form4"
  | "nasdaq_earnings"
  | "finra_short_interest"
  | "senate_efd"
  | "sec_13f"
  | "sec_8k"
  | "social_calls";

export interface InsiderTransactionPayload {
  insider_name: string;
  is_officer: boolean;
  is_director: boolean;
  is_ten_percent_owner: boolean;
  shares: number;
  price: number | null;
  dollar_value: number | null;
}

export interface InsiderClusterBuyPayload {
  insider_count: number;
  insider_names: string[];
  window_days: number;
  combined_dollar_value: number;
}

/**
 * standardized_surprise is signed ((actual - estimate) / prior close); the
 * event's score is its absolute value so min-score filters mean "surprise at
 * least this large" for beats and misses alike. Both are null when no daily
 * close exists at or before the announcement to scale by.
 */
export interface EarningsSurprisePayload {
  eps_actual: number;
  eps_estimate: number;
  num_estimates: number | null;
  standardized_surprise: number | null;
  announce_time: "not-supplied" | "pre-market" | "after-hours";
  fiscal_period: string;
}

export interface ShortInterestPayload {
  settlement_date: string;
  short_interest: number;
  previous_short_interest: number | null;
  change_percent: number | null;
  average_daily_volume: number | null;
  days_to_cover: number | null;
  market_class: string;
}

/**
 * A STOCK Act periodic transaction report row. available_ts is the disclosure
 * filing date, never the trade date: the gap between them (up to 45 days) is
 * disclosure_lag_days, and prompt_disclosure marks lags within a fixed
 * ingestion constant so evaluations can split prompt vs stale disclosures.
 */
export interface CongressTradePayload {
  member: string;
  chamber: "senate";
  owner: string;
  transaction_type: "purchase" | "sale_full" | "sale_partial";
  asset_name: string;
  amount_low: number;
  amount_high: number | null;
  reported_trade_date: string;
  disclosure_lag_days: number;
  prompt_disclosure: boolean;
}

/**
 * A curated 13F manager opening (new stake) or closing (exit) a position
 * between consecutive quarterly filings. Values describe the position in the
 * filing where it exists: the current filing for new stakes, the prior one for
 * exits. Holdings are ~45 days stale when the filing lands; available_ts is
 * the EDGAR acceptance datetime, so that staleness is part of what is tested.
 */
export interface InstitutionalStakePayload {
  manager: string;
  cik: number;
  period: string;
  prior_period: string;
  cusip: string;
  issuer_name: string;
  value_usd: number;
  shares: number;
  portfolio_share: number;
  portfolio_total_usd: number;
  filing_lag_days: number;
}

/**
 * An LLM-labeled 8-K material event. available_ts is the EDGAR acceptance
 * datetime, which is also when the event became public, so event_ts equals it.
 * `labeler_version` (model + prompt hash) pins the label an evaluation trusts:
 * relabeling under a new version writes new rows, and an evaluation filters this
 * field so it never mixes versions. `guidance` reuses section 1b's shared figure
 * schema - the extraction path reads these same figures, they are not duplicated.
 */
export interface FilingLabelEventPayload {
  cik: number;
  accession: string;
  items: string[];
  direction: LabelDirection;
  severity: number;
  rationale: string;
  guidance: GuidanceFigure[];
  labeler_version: string;
}

/**
 * A guidance revision recovered by section 1b's extraction path: a filing's
 * guided figure for some future period compared against the same company's
 * prior guide for that same metric/period (self-relative, so no consensus data
 * is needed). `revision_pct` is signed ((new - prior) / |prior| midpoint) and
 * the event's score is its absolute value, so a min-score filter means "revision
 * at least this large" for raises and cuts alike. A withdrawal carries no
 * synthetic number: `withdrawn` is true, `new_midpoint`/`revision_pct` are null,
 * and the score is null so it never enters a magnitude bucket. `new_figure` and
 * `prior_figure` reuse the labeler's shared GuidanceFigure shape rather than
 * duplicating it. available_ts is the acceptance datetime of the filing that
 * issued the new guide.
 */
export interface GuidanceRevisionPayload {
  cik: number;
  accession: string;
  prior_accession: string;
  new_figure: GuidanceFigure;
  prior_figure: GuidanceFigure;
  new_midpoint: number | null;
  prior_midpoint: number;
  revision_pct: number | null;
  withdrawn: boolean;
  labeler_version: string;
  /** Nearest same-ticker earnings event within 36h; 0/1 for payload filters. */
  paired_beat: 0 | 1;
  paired_miss: 0 | 1;
  paired_surprise: number | null;
}

/**
 * One directional call on one ticker read out of a public social post by an
 * LLM labeler (text plus attached images). available_ts equals event_ts: a
 * public post is public when posted. The score is null on purpose: the only
 * candidate, model confidence, is not evidence. `is_first_call` is false for
 * a call on a ticker the same account already called the same way inside the
 * prior 90 days, so a `{ is_first_call: 1 }` payload filter excludes
 * re-statements of one trade. Engagement counts are deliberately absent: they
 * are read at scrape time, after the outcome, and are lookahead.
 */
export interface SocialCallPayload {
  post_id: string;
  direction: "up" | "down";
  is_reply: boolean;
  is_quote: boolean;
  is_first_call: boolean;
  has_image: boolean;
  labeler_version: string;
}

export interface EventPayloadByKind {
  insider_buy: InsiderTransactionPayload;
  insider_sell: InsiderTransactionPayload;
  insider_cluster_buy: InsiderClusterBuyPayload;
  earnings_beat: EarningsSurprisePayload;
  earnings_miss: EarningsSurprisePayload;
  short_interest_report: ShortInterestPayload;
  short_interest_spike: ShortInterestPayload;
  congress_buy: CongressTradePayload;
  congress_sell: CongressTradePayload;
  inst_new_stake: InstitutionalStakePayload;
  inst_exit: InstitutionalStakePayload;
  filing_guidance_up: FilingLabelEventPayload;
  filing_guidance_down: FilingLabelEventPayload;
  filing_buyback: FilingLabelEventPayload;
  filing_exec_departure: FilingLabelEventPayload;
  guidance_raise: GuidanceRevisionPayload;
  guidance_cut: GuidanceRevisionPayload;
  social_call_bullish: SocialCallPayload;
  social_call_bearish: SocialCallPayload;
}

export type EventKind = keyof EventPayloadByKind;

const eventKindFlags: Record<EventKind, true> = {
  insider_buy: true,
  insider_sell: true,
  insider_cluster_buy: true,
  earnings_beat: true,
  earnings_miss: true,
  short_interest_report: true,
  short_interest_spike: true,
  congress_buy: true,
  congress_sell: true,
  inst_new_stake: true,
  inst_exit: true,
  filing_guidance_up: true,
  filing_guidance_down: true,
  filing_buyback: true,
  filing_exec_departure: true,
  guidance_raise: true,
  guidance_cut: true,
  social_call_bullish: true,
  social_call_bearish: true,
};

export const eventKinds = Object.keys(eventKindFlags) as EventKind[];

export function isEventKind(value: string): value is EventKind {
  return Object.hasOwn(eventKindFlags, value);
}

export type EventPayload = EventPayloadByKind[EventKind];

/**
 * Point-in-time contract: event_ts_ms is when it happened, available_ts_ms is
 * when the public could know. Evaluation and trading logic must only ever use
 * available_ts_ms; available_ts_ms >= event_ts_ms is enforced at insert.
 */
export interface EventRecord<K extends EventKind = EventKind> {
  id?: number;
  source: EventSourceId;
  ticker: string;
  event_kind: K;
  event_ts_ms: number;
  available_ts_ms: number;
  score: number | null;
  payload: EventPayloadByKind[K];
  dedupe_key: string;
  created_at?: string;
}
