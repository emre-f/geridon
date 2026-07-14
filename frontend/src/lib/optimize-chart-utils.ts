import type {
  OptimizationExperimentSummary,
  OptimizationTrialRecord,
} from "@/lib/api-optimization-experiment-types";
import type {
  FoldEvaluation,
  OptimizationObjective,
  SearchSpaceNode,
} from "@/lib/api-optimization-types";
import { inLeaderboardOrder } from "./optimize-detail-utils.ts";

export const objectiveLabels: Record<OptimizationObjective, string> = {
  sharpe: "Sharpe",
  annualized_return: "Annualized return %",
  total_return: "Total return %",
};

export const penaltyOrder = ["drawdown", "instability", "turnover", "complexity"] as const;
export type PenaltyKind = (typeof penaltyOrder)[number];

export const penaltyColors: Record<PenaltyKind, string> = {
  drawdown: "var(--viz-penalty-drawdown)",
  instability: "var(--viz-penalty-instability)",
  turnover: "var(--viz-penalty-turnover)",
  complexity: "var(--viz-penalty-complexity)",
};

export const seriesColors = {
  candidate: "var(--viz-candidate)",
  baseline: "var(--viz-baseline)",
  buyHold: "var(--viz-buy-hold)",
  netScore: "var(--viz-baseline)",
};

export interface DecompositionRow {
  key: string;
  label: string;
  trialIndex: number | null;
  medianObjective: number;
  penalties: Record<PenaltyKind, number>;
  score: number;
}

export function decompositionRows(
  summary: OptimizationExperimentSummary,
  trials: OptimizationTrialRecord[],
  limit = 8,
): DecompositionRow[] {
  const rows: DecompositionRow[] = [
    {
      key: "baseline",
      label: "Baseline",
      trialIndex: null,
      medianObjective: summary.baseline.score.medianObjective,
      penalties: summary.baseline.score.penalties,
      score: summary.baseline.score.score,
    },
  ];
  const eligible = inLeaderboardOrder(
    trials.filter((trial) => trial.status === "scored" && trial.score?.eligible),
  );
  for (const trial of eligible.slice(0, limit)) {
    rows.push({
      key: `trial-${trial.trial_index}`,
      label: trial.rank != null ? `#${trial.rank} · t${trial.trial_index}` : `t${trial.trial_index}`,
      trialIndex: trial.trial_index,
      medianObjective: trial.score!.medianObjective,
      penalties: trial.score!.penalties,
      score: trial.score!.score,
    });
  }
  return rows;
}

export interface FoldGroup {
  key: string;
  label: string;
  symbol: string;
  foldIndex: number;
  baseline: number | null;
  buyHold: number | null;
  candidate: number | null;
}

export function foldGroups(
  baseline: FoldEvaluation[],
  buyHold: FoldEvaluation[],
  candidate: FoldEvaluation[] | null,
): FoldGroup[] {
  const groups = new Map<string, FoldGroup>();
  const groupFor = (fold: FoldEvaluation) => {
    const key = `${fold.symbol}#${fold.foldIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: "",
        symbol: fold.symbol,
        foldIndex: fold.foldIndex,
        baseline: null,
        buyHold: null,
        candidate: null,
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const fold of baseline) {
    groupFor(fold).baseline = fold.objectiveValue;
  }
  for (const fold of buyHold) {
    groupFor(fold).buyHold = fold.objectiveValue;
  }
  for (const fold of candidate ?? []) {
    groupFor(fold).candidate = fold.objectiveValue;
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.foldIndex - b.foldIndex,
  );
  const multiSymbol = new Set(ordered.map((group) => group.symbol)).size > 1;
  for (const group of ordered) {
    group.label = multiSymbol
      ? `${group.symbol} F${group.foldIndex + 1}`
      : `Fold ${group.foldIndex + 1}`;
  }
  return ordered;
}

// Search-space node ids are dotted strategy paths such as
// "entry.conditions.0.left.params.fast"; this compresses them into a short
// human label like "entry r1 fast".
export function nodeLabel(node: SearchSpaceNode): string {
  if (node.path[0] === "sizing") {
    if (node.path[1] === "buyPercent") {
      return "buy %";
    }
    if (node.path[1] === "sellPercent") {
      return "sell %";
    }
    return node.path.join(" ");
  }
  const side = node.path[0] ?? "";
  const ruleNumbers = node.path
    .filter((segment) => /^\d+$/.test(segment))
    .map((segment) => String(Number(segment) + 1))
    .join(".");
  const lastSegment = node.path.at(-1) ?? node.id;
  const name = lastSegment === "value" ? "threshold" : lastSegment;
  return [side, ruleNumbers ? `r${ruleNumbers}` : "", name].filter(Boolean).join(" ");
}

export function formatSampledValue(value: number | boolean | string): string {
  if (typeof value === "boolean") {
    return value ? "on" : "off";
  }
  if (typeof value === "string") {
    return value.replace(/_/g, " ");
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function bestScoredTrial(
  trials: OptimizationTrialRecord[],
  bestTrialIndex: number | null,
): OptimizationTrialRecord | null {
  if (bestTrialIndex != null) {
    const best = trials.find((trial) => trial.trial_index === bestTrialIndex);
    if (best?.score) {
      return best;
    }
  }
  let best: OptimizationTrialRecord | null = null;
  for (const trial of trials) {
    if (trial.status !== "scored" || trial.score == null) {
      continue;
    }
    if (best?.score == null || trial.score.score > best.score.score) {
      best = trial;
    }
  }
  return best;
}
