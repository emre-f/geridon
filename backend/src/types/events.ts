export type EventSourceId = "sec_form4";

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

export interface EventPayloadByKind {
  insider_buy: InsiderTransactionPayload;
  insider_sell: InsiderTransactionPayload;
  insider_cluster_buy: InsiderClusterBuyPayload;
}

export type EventKind = keyof EventPayloadByKind;

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
