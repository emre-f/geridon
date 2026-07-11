import type {
  OptimizationExperimentListItem,
  OptimizationExperimentStatus,
  OptimizationMethod,
  OptimizationTrialRecord,
} from "@/lib/api";

export const statusLabels: Record<OptimizationExperimentStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  failed: "Failed",
};

export const statusBadgeVariant: Record<
  OptimizationExperimentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  running: "default",
  completed: "outline",
  cancelled: "secondary",
  interrupted: "destructive",
  failed: "destructive",
};

export const methodLabels: Record<OptimizationMethod, string> = {
  random: "Random search",
  tpe: "Bayesian (TPE)",
  evolution: "Evolution",
};

export function canCancel(status: OptimizationExperimentStatus) {
  return status === "queued" || status === "running";
}

export function canResume(status: OptimizationExperimentStatus) {
  return status === "interrupted" || status === "cancelled" || status === "failed";
}

export function progressFraction(experiment: OptimizationExperimentListItem) {
  const progress = experiment.progress;
  if (!progress || experiment.max_trials <= 0) {
    return null;
  }
  return Math.min(1, progress.evaluated_trials / experiment.max_trials);
}

const ranAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface TrialBadge {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  title?: string;
}

export function trialStatusBadge(trial: OptimizationTrialRecord): TrialBadge {
  if (trial.status === "rejected") {
    return { label: "Rejected", variant: "secondary", title: trial.rejection_reason ?? undefined };
  }
  if (trial.status === "pruned") {
    return {
      label: "Pruned",
      variant: "secondary",
      title: `Dropped by successive halving after stage ${trial.stage_reached}`,
    };
  }
  if (trial.status === "pending") {
    return { label: "Pending", variant: "secondary" };
  }
  if (trial.score?.eligible) {
    return { label: "Eligible", variant: "outline" };
  }
  return {
    label: "Ineligible",
    variant: "secondary",
    title: trial.score?.ineligibilityReasons.join("; "),
  };
}

export function formatExperimentCreatedAt(createdAt: string) {
  const ms = Date.parse(createdAt.includes("Z") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(ms)) {
    return createdAt;
  }
  return ranAtFormat.format(new Date(ms));
}
