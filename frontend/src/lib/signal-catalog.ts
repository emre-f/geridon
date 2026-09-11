import type { SignalEventKind, SignalOperand, SignalOutput } from "@/lib/api-strategy-types";

export interface SignalFilterField {
  key: string;
  label: string;
  /** Boolean payload flags compare as 0/1; adding one requires the flag to be true. */
  boolean?: boolean;
  step?: number;
}

export interface SignalKindDefinition {
  kind: SignalEventKind;
  label: string;
  description: string;
  filterFields: SignalFilterField[];
}

const scoreField: SignalFilterField = { key: "score", label: "Min score", step: 0.1 };

const insiderTransactionFields: SignalFilterField[] = [
  scoreField,
  { key: "dollar_value", label: "Min dollar value", step: 1000 },
  { key: "shares", label: "Min shares", step: 100 },
  { key: "price", label: "Min price", step: 1 },
  { key: "is_officer", label: "Officers only", boolean: true },
  { key: "is_director", label: "Directors only", boolean: true },
  { key: "is_ten_percent_owner", label: "10% owners only", boolean: true },
];

const earningsSurpriseFields: SignalFilterField[] = [
  scoreField,
  { key: "num_estimates", label: "Min analyst estimates", step: 1 },
];

const congressTradeFields: SignalFilterField[] = [
  scoreField,
  { key: "amount_low", label: "Min amount (range low)", step: 1000 },
  { key: "disclosure_lag_days", label: "Min disclosure lag (days)", step: 1 },
  { key: "prompt_disclosure", label: "Prompt disclosures only (14 days or less)", boolean: true },
];

const shortInterestFields: SignalFilterField[] = [
  scoreField,
  { key: "days_to_cover", label: "Min days to cover", step: 0.5 },
  { key: "change_percent", label: "Min change %", step: 5 },
  { key: "short_interest", label: "Min short interest shares", step: 100000 },
];

const institutionalStakeFields: SignalFilterField[] = [
  scoreField,
  { key: "value_usd", label: "Min position value ($)", step: 1000000 },
  { key: "portfolio_total_usd", label: "Min manager portfolio ($)", step: 100000000 },
];

const severityFields: SignalFilterField[] = [{ key: "score", label: "Min severity (1-5)", step: 1 }];

const guidanceRevisionFields: SignalFilterField[] = [
  { key: "score", label: "Min revision magnitude", step: 0.01 },
  { key: "paired_beat", label: "Same-release earnings beat only", boolean: true },
  { key: "paired_miss", label: "Same-release earnings miss only", boolean: true },
];

export const signalCatalog: SignalKindDefinition[] = [
  {
    kind: "insider_cluster_buy",
    label: "Insider Cluster Buy",
    description: "Multiple insiders buying the same ticker within a short window.",
    filterFields: [
      scoreField,
      { key: "insider_count", label: "Min insiders", step: 1 },
      { key: "combined_dollar_value", label: "Min combined dollar value", step: 10000 },
    ],
  },
  {
    kind: "insider_buy",
    label: "Insider Buy",
    description: "A single open-market insider purchase from a Form 4 filing.",
    filterFields: insiderTransactionFields,
  },
  {
    kind: "insider_sell",
    label: "Insider Sell",
    description: "A single open-market insider sale from a Form 4 filing.",
    filterFields: insiderTransactionFields,
  },
  {
    kind: "earnings_beat",
    label: "Earnings Beat",
    description: "Reported EPS above the consensus estimate; score is the price-scaled surprise.",
    filterFields: earningsSurpriseFields,
  },
  {
    kind: "earnings_miss",
    label: "Earnings Miss",
    description: "Reported EPS below the consensus estimate; score is the price-scaled surprise.",
    filterFields: earningsSurpriseFields,
  },
  {
    kind: "short_interest_report",
    label: "Short Interest Report",
    description:
      "A FINRA bi-monthly short interest cycle for the ticker; score is days to cover.",
    filterFields: shortInterestFields,
  },
  {
    kind: "short_interest_spike",
    label: "Short Interest Spike",
    description:
      "Short interest jumped at least 50% vs the prior cycle with days to cover of 2 or more; score is the change percent.",
    filterFields: shortInterestFields,
  },
  {
    kind: "congress_buy",
    label: "Congress Buy",
    description:
      "A senator's reported stock purchase from a STOCK Act disclosure; available only once filed, up to 45 days after the trade.",
    filterFields: congressTradeFields,
  },
  {
    kind: "congress_sell",
    label: "Congress Sell",
    description:
      "A senator's reported stock sale from a STOCK Act disclosure; available only once filed, up to 45 days after the trade.",
    filterFields: congressTradeFields,
  },
  {
    kind: "inst_new_stake",
    label: "Institutional New Stake",
    description:
      "A curated 13F manager opened a position last quarter; score is its share of their long book. Holdings are about 45 days stale when filed.",
    filterFields: institutionalStakeFields,
  },
  {
    kind: "inst_exit",
    label: "Institutional Exit",
    description:
      "A curated 13F manager closed a position last quarter; score is its prior share of their long book. Holdings are about 45 days stale when filed.",
    filterFields: institutionalStakeFields,
  },
  {
    kind: "filing_guidance_up",
    label: "8-K Guidance Up",
    description:
      "An LLM-labeled 8-K where management framed its guidance as raised; score is severity 1 to 5.",
    filterFields: severityFields,
  },
  {
    kind: "filing_guidance_down",
    label: "8-K Guidance Down",
    description:
      "An LLM-labeled 8-K where management framed its guidance as lowered or withdrawn; score is severity 1 to 5.",
    filterFields: severityFields,
  },
  {
    kind: "filing_buyback",
    label: "8-K Buyback",
    description: "An LLM-labeled 8-K announcing a share repurchase program; score is severity 1 to 5.",
    filterFields: severityFields,
  },
  {
    kind: "filing_exec_departure",
    label: "8-K Exec Departure",
    description:
      "An LLM-labeled 8-K reporting an unplanned executive departure; score is severity 1 to 5.",
    filterFields: severityFields,
  },
  {
    kind: "guidance_raise",
    label: "Guidance Raise",
    description:
      "A guided figure's midpoint moved up vs the company's prior guide for the same metric and period; score is the revision magnitude.",
    filterFields: guidanceRevisionFields,
  },
  {
    kind: "guidance_cut",
    label: "Guidance Cut",
    description:
      "A guided figure's midpoint moved down vs the company's prior guide, or the outlook was withdrawn; score is the revision magnitude.",
    filterFields: [...guidanceRevisionFields, { key: "withdrawn", label: "Withdrawals only", boolean: true }],
  },
];

export const signalOutputOptions: Array<{
  value: SignalOutput;
  label: string;
  description: string;
}> = [
  {
    value: "days_since",
    label: "Days since",
    description:
      "Bars since the last matching event became available. Infinite before the first, so rules stay inert until an event exists.",
  },
  {
    value: "count_in_window",
    label: "Count in window",
    description: "Matching events that became available over the trailing window of bars.",
  },
  {
    value: "last_score",
    label: "Last score",
    description: "The most recent matching event's score, carried forward bar by bar.",
  },
];

export function signalKindDefinition(kind: string): SignalKindDefinition | undefined {
  return signalCatalog.find((definition) => definition.kind === kind);
}

export function signalKindLabel(kind: string): string {
  return (
    signalKindDefinition(kind)?.label ??
    kind
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export function defaultSignalOperand(): SignalOperand {
  return { type: "signal", kind: signalCatalog[0].kind, output: "days_since" };
}

export function signalOperandSummary(operand: SignalOperand): string {
  const label = signalKindLabel(operand.kind);
  const core =
    operand.output === "count_in_window"
      ? `${label} count (${operand.window ?? 1} bars)`
      : operand.output === "last_score"
        ? `${label} last score`
        : `Days since ${label}`;
  const filterCount = operand.filters ? Object.keys(operand.filters).length : 0;
  if (filterCount === 0) {
    return core;
  }
  return `${core} (${filterCount} filter${filterCount === 1 ? "" : "s"})`;
}
