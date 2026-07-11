import type { OptimizationExperimentListItem, OptimizationExperimentStatus, OptimizationMethod } from "@/lib/api";

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
  if (!progress || progress.max_trials <= 0) {
    return null;
  }
  return Math.min(1, progress.evaluated_trials / progress.max_trials);
}

const ranAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatExperimentCreatedAt(createdAt: string) {
  const ms = Date.parse(createdAt.includes("Z") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(ms)) {
    return createdAt;
  }
  return ranAtFormat.format(new Date(ms));
}
