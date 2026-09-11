import type { Database } from "../../db.ts";
import type { EventKind } from "../../types/events.ts";
import { listEvaluations, type SignalVerdict } from "./registry.ts";

export interface RegistryKindSummary {
  event_kind: EventKind;
  evaluations: number;
  verdicts: Record<SignalVerdict, number>;
  best_t_stat: number | null;
  median_t_stat: number | null;
  best_net_abnormal_return: number | null;
  median_net_abnormal_return: number | null;
  holdouts_consumed: number;
}

/**
 * total_draws is the multiple-testing counter the UI must show prominently:
 * at p < 0.05, roughly one evaluation in twenty looks good by luck alone.
 */
export interface RegistrySummary {
  total_draws: number;
  expected_lucky: number;
  kinds: RegistryKindSummary[];
}

export function getRegistrySummary(db: Database): RegistrySummary {
  const evaluations = listEvaluations(db);
  const byKind = new Map<EventKind, RegistryKindSummary & { t_stats: number[]; nets: number[] }>();

  for (const evaluation of evaluations) {
    let summary = byKind.get(evaluation.event_kind);
    if (summary == null) {
      summary = {
        event_kind: evaluation.event_kind,
        evaluations: 0,
        verdicts: { no_signal: 0, weak: 0, candidate: 0 },
        best_t_stat: null,
        median_t_stat: null,
        best_net_abnormal_return: null,
        median_net_abnormal_return: null,
        holdouts_consumed: 0,
        t_stats: [],
        nets: [],
      };
      byKind.set(evaluation.event_kind, summary);
    }
    summary.evaluations += 1;
    summary.verdicts[evaluation.verdict] += 1;
    summary.t_stats.push(evaluation.headline.baseline_gap_t_stat);
    summary.nets.push(evaluation.headline.net_abnormal_return);
    if (evaluation.holdout_consumed_at != null) {
      summary.holdouts_consumed += 1;
    }
  }

  const kinds = [...byKind.values()]
    .map(({ t_stats, nets, ...summary }) => ({
      ...summary,
      best_t_stat: Math.max(...t_stats),
      median_t_stat: median(t_stats),
      best_net_abnormal_return: Math.max(...nets),
      median_net_abnormal_return: median(nets),
    }))
    .sort((left, right) => left.event_kind.localeCompare(right.event_kind));

  return {
    total_draws: evaluations.length,
    expected_lucky: evaluations.length / 20,
    kinds,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
