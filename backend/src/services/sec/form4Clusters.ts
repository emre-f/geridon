import { createHash } from "node:crypto";

import type { Database } from "../../db.ts";
import type { EventRecord } from "../../types/events.ts";
import { getEvents, getKnownTickers, insertEvents } from "../eventStore.ts";

const dayMs = 86_400_000;

export interface ClusterParams {
  minInsiders: number;
  windowDays: number;
  minCombinedDollarValue: number;
}

export const defaultClusterParams: ClusterParams = {
  minInsiders: 2,
  windowDays: 10,
  minCombinedDollarValue: 100_000,
};

export interface ClusterDeriveSummary {
  buys_considered: number;
  clusters_inserted: number;
  previous_clusters_removed: number;
}

/**
 * Derived kind: recomputed from scratch on every run (delete + rebuild), so
 * re-derivation after new quarters land is idempotent by construction.
 *
 * A cluster is emitted at the buy that first satisfies the condition (>= N
 * distinct insider names and >= $V combined within the trailing W-day window
 * of transaction dates); the window is then consumed, so a long run of buys
 * yields disjoint clusters instead of one per additional buy. available_ts is
 * the latest member's filing time: the cluster only exists once the last
 * member is public.
 */
export function deriveInsiderClusterBuys(
  db: Database,
  params: ClusterParams = defaultClusterParams,
): ClusterDeriveSummary {
  const removed = db
    .prepare("DELETE FROM events WHERE event_kind = 'insider_cluster_buy'")
    .run();

  const buys = getEvents(db, { kind: "insider_buy" }) as EventRecord<"insider_buy">[];
  const byTicker = new Map<string, EventRecord<"insider_buy">[]>();
  for (const buy of buys) {
    const tickerBuys = byTicker.get(buy.ticker) ?? [];
    tickerBuys.push(buy);
    byTicker.set(buy.ticker, tickerBuys);
  }

  const clusters: EventRecord<"insider_cluster_buy">[] = [];
  for (const [ticker, tickerBuys] of byTicker) {
    tickerBuys.sort(
      (a, b) =>
        a.event_ts_ms - b.event_ts_ms ||
        a.available_ts_ms - b.available_ts_ms ||
        a.dedupe_key.localeCompare(b.dedupe_key),
    );

    let window: EventRecord<"insider_buy">[] = [];
    for (const buy of tickerBuys) {
      window = window.filter(
        (member) => buy.event_ts_ms - member.event_ts_ms <= params.windowDays * dayMs,
      );
      window.push(buy);

      const names = new Set<string>();
      for (const member of window) {
        for (const name of member.payload.insider_name.split("; ")) {
          names.add(name);
        }
      }
      const combinedValue = window.reduce(
        (sum, member) => sum + (member.payload.dollar_value ?? 0),
        0,
      );
      if (names.size >= params.minInsiders && combinedValue >= params.minCombinedDollarValue) {
        clusters.push(buildCluster(ticker, window, names, combinedValue, params));
        window = [];
      }
    }
  }

  const summary = insertEvents(db, clusters, { knownTickers: getKnownTickers(db) });
  return {
    buys_considered: buys.length,
    clusters_inserted: summary.inserted,
    previous_clusters_removed: Number(removed.changes),
  };
}

function buildCluster(
  ticker: string,
  members: readonly EventRecord<"insider_buy">[],
  names: ReadonlySet<string>,
  combinedValue: number,
  params: ClusterParams,
): EventRecord<"insider_cluster_buy"> {
  const memberDigest = createHash("sha256")
    .update(members.map((member) => member.dedupe_key).sort().join("|"))
    .digest("hex")
    .slice(0, 16);

  return {
    source: "sec_form4",
    ticker,
    event_kind: "insider_cluster_buy",
    event_ts_ms: Math.max(...members.map((member) => member.event_ts_ms)),
    available_ts_ms: Math.max(...members.map((member) => member.available_ts_ms)),
    score: Math.log10(combinedValue),
    payload: {
      insider_count: names.size,
      insider_names: [...names].sort(),
      window_days: params.windowDays,
      combined_dollar_value: combinedValue,
    },
    dedupe_key: `sec_form4:cluster:${ticker}:${memberDigest}`,
  };
}
