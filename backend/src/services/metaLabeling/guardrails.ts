import type { WalkForwardResult } from "./walkForward.ts";

export type GuardrailSeverity = "warn" | "refuse";
export type GuardrailStatus = "ok" | "warn" | "refuse";

export type GuardrailCode =
  | "too_few_triggers"
  | "class_imbalance"
  | "sparse_validation_fold"
  | "untrained_fold";

export interface GuardrailFinding {
  code: GuardrailCode;
  severity: GuardrailSeverity;
  message: string;
  detail: Record<string, number>;
}

export interface GuardrailReport {
  status: GuardrailStatus;
  findings: GuardrailFinding[];
  total_events: number;
  positive_events: number;
  negative_events: number;
  minority_fraction: number;
}

export const guardrailThresholds = {
  refuseBelowTriggers: 40,
  warnBelowTriggers: 200,
  refuseMinorityFraction: 0.05,
  warnMinorityFraction: 0.15,
  warnFoldValidationEvents: 5,
} as const;

function worst(a: GuardrailStatus, b: GuardrailStatus): GuardrailStatus {
  const rank: Record<GuardrailStatus, number> = { ok: 0, warn: 1, refuse: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function evaluateGuardrails(wf: WalkForwardResult): GuardrailReport {
  const findings: GuardrailFinding[] = [];
  const total = wf.total_events;
  const minorityCount = Math.min(wf.positive_events, wf.negative_events);
  const minorityFraction = total === 0 ? 0 : minorityCount / total;

  if (total < guardrailThresholds.refuseBelowTriggers) {
    findings.push({
      code: "too_few_triggers",
      severity: "refuse",
      message: `Only ${total} trade triggers; meta-labeling needs hundreds to learn from, not dozens.`,
      detail: { total_events: total, refuse_below: guardrailThresholds.refuseBelowTriggers },
    });
  } else if (total < guardrailThresholds.warnBelowTriggers) {
    findings.push({
      code: "too_few_triggers",
      severity: "warn",
      message: `${total} trade triggers is below the ${guardrailThresholds.warnBelowTriggers} recommended for a reliable overlay.`,
      detail: { total_events: total, warn_below: guardrailThresholds.warnBelowTriggers },
    });
  }

  if (total > 0) {
    if (minorityFraction < guardrailThresholds.refuseMinorityFraction) {
      findings.push({
        code: "class_imbalance",
        severity: "refuse",
        message: `Only ${(minorityFraction * 100).toFixed(1)}% of triggers are the minority outcome; there is nothing to separate.`,
        detail: { minority_count: minorityCount, total_events: total },
      });
    } else if (minorityFraction < guardrailThresholds.warnMinorityFraction) {
      findings.push({
        code: "class_imbalance",
        severity: "warn",
        message: `Trades are imbalanced at ${(minorityFraction * 100).toFixed(1)}% minority outcome; precision/recall will be noisy.`,
        detail: { minority_count: minorityCount, total_events: total },
      });
    }
  }

  for (const foldIndex of wf.untrained_folds) {
    findings.push({
      code: "untrained_fold",
      severity: "warn",
      message: `Fold ${foldIndex} had a single label class in training, so the overlay took every trade there.`,
      detail: { fold_index: foldIndex },
    });
  }

  const untrained = new Set(wf.untrained_folds);
  wf.validation_sizes.forEach((size, foldIndex) => {
    if (untrained.has(foldIndex)) {
      return;
    }
    if (size < guardrailThresholds.warnFoldValidationEvents) {
      findings.push({
        code: "sparse_validation_fold",
        severity: "warn",
        message: `Fold ${foldIndex} scored only ${size} trade(s); its per-fold evidence is near-zero.`,
        detail: { fold_index: foldIndex, validation_events: size },
      });
    }
  });

  const status = findings.reduce<GuardrailStatus>((acc, finding) => worst(acc, finding.severity), "ok");

  return {
    status,
    findings,
    total_events: total,
    positive_events: wf.positive_events,
    negative_events: wf.negative_events,
    minority_fraction: minorityFraction,
  };
}
