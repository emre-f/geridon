import type {
  SignalEventKind,
  SignalEventQuery,
  SignalSelectionStats,
  SignalUniverseFilters,
} from "@/lib/api-client-signals-evaluations";

export interface SignalEvaluationFormState {
  kind: SignalEventKind;
  minScore: string;
  officersOnly: boolean;
  minDollarValue: string;
  minInsiderCount: string;
  minCombinedDollarValue: string;
  minNumEstimates: string;
  minDaysToCover: string;
  minChangePercent: string;
  minAmountLow: string;
  minDisclosureLagDays: string;
  promptDisclosuresOnly: boolean;
  minPrice: string;
  minMedianDollarVolume: string;
  startDate: string;
  endDate: string;
  seed: number;
}

export const initialSignalEvaluationForm: SignalEvaluationFormState = {
  kind: "insider_cluster_buy",
  minScore: "",
  officersOnly: false,
  minDollarValue: "",
  minInsiderCount: "",
  minCombinedDollarValue: "",
  minNumEstimates: "",
  minDaysToCover: "",
  minChangePercent: "",
  minAmountLow: "",
  minDisclosureLagDays: "",
  promptDisclosuresOnly: false,
  minPrice: "",
  minMedianDollarVolume: "",
  startDate: "",
  endDate: "",
  seed: 1,
};

export const signalKindLabels: Record<SignalEventKind, string> = {
  insider_buy: "Insider buy",
  insider_sell: "Insider sell",
  insider_cluster_buy: "Insider cluster buy",
  earnings_beat: "Earnings beat",
  earnings_miss: "Earnings miss",
  short_interest_report: "Short interest report",
  short_interest_spike: "Short interest spike",
  congress_buy: "Congress buy",
  congress_sell: "Congress sell",
  inst_new_stake: "Institutional new stake",
  inst_exit: "Institutional exit",
  filing_guidance_up: "8-K guidance up",
  filing_guidance_down: "8-K guidance down",
  filing_buyback: "8-K buyback",
  filing_exec_departure: "8-K exec departure",
  guidance_raise: "Guidance raise",
  guidance_cut: "Guidance cut",
};

const dayMs = 86_400_000;

function parseFinite(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : null;
}

function parseDateMs(raw: string): number | null {
  if (raw.trim() === "") {
    return null;
  }
  const ms = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function payloadFilters(state: SignalEvaluationFormState): Record<string, number> {
  const filters: Record<string, number> = {};
  if (state.kind === "insider_cluster_buy") {
    const insiderCount = parseFinite(state.minInsiderCount);
    if (insiderCount != null) {
      filters.insider_count = insiderCount;
    }
    const combined = parseFinite(state.minCombinedDollarValue);
    if (combined != null) {
      filters.combined_dollar_value = combined;
    }
    return filters;
  }
  if (state.kind === "earnings_beat" || state.kind === "earnings_miss") {
    const numEstimates = parseFinite(state.minNumEstimates);
    if (numEstimates != null) {
      filters.num_estimates = numEstimates;
    }
    return filters;
  }
  if (state.kind === "short_interest_report" || state.kind === "short_interest_spike") {
    const daysToCover = parseFinite(state.minDaysToCover);
    if (daysToCover != null) {
      filters.days_to_cover = daysToCover;
    }
    const changePercent = parseFinite(state.minChangePercent);
    if (changePercent != null) {
      filters.change_percent = changePercent;
    }
    return filters;
  }
  if (state.kind === "congress_buy" || state.kind === "congress_sell") {
    const amountLow = parseFinite(state.minAmountLow);
    if (amountLow != null) {
      filters.amount_low = amountLow;
    }
    const lagDays = parseFinite(state.minDisclosureLagDays);
    if (lagDays != null) {
      filters.disclosure_lag_days = lagDays;
    }
    if (state.promptDisclosuresOnly) {
      filters.prompt_disclosure = 1;
    }
    return filters;
  }
  if (state.officersOnly) {
    filters.is_officer = 1;
  }
  const dollarValue = parseFinite(state.minDollarValue);
  if (dollarValue != null) {
    filters.dollar_value = dollarValue;
  }
  return filters;
}

export function buildSignalQuery(state: SignalEvaluationFormState): SignalEventQuery {
  const query: SignalEventQuery = { kind: state.kind };

  const minScore = parseFinite(state.minScore);
  if (minScore != null) {
    query.min_score = minScore;
  }

  const filters = payloadFilters(state);
  if (Object.keys(filters).length > 0) {
    query.payload_filters = filters;
  }

  const universe: SignalUniverseFilters = {};
  const minPrice = parseFinite(state.minPrice);
  if (minPrice != null && minPrice >= 0) {
    universe.min_price = minPrice;
  }
  const minDollarVolume = parseFinite(state.minMedianDollarVolume);
  if (minDollarVolume != null && minDollarVolume >= 0) {
    universe.min_median_dollar_volume = minDollarVolume;
  }
  if (Object.keys(universe).length > 0) {
    query.universe = universe;
  }

  const startMs = parseDateMs(state.startDate);
  const endMs = parseDateMs(state.endDate);
  if (startMs != null) {
    query.start_ms = startMs;
  }
  if (endMs != null && (startMs == null || endMs >= startMs)) {
    query.end_ms = endMs + dayMs - 1;
  }

  return query;
}

const exclusionLabels: Record<keyof SignalSelectionStats["excluded"], string> = {
  min_score: "below min score",
  payload_filters: "failed payload filters",
  no_anchor: "no trading bar to anchor",
  insufficient_history: "too little price history",
  below_min_price: "below min price",
  below_min_dollar_volume: "below min dollar volume",
};

export function exclusionSummary(stats: SignalSelectionStats): string[] {
  const lines: string[] = [];
  for (const reason of Object.keys(exclusionLabels) as (keyof SignalSelectionStats["excluded"])[]) {
    if (stats.excluded[reason] > 0) {
      lines.push(`${stats.excluded[reason].toLocaleString()} ${exclusionLabels[reason]}`);
    }
  }
  return lines;
}
