import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import {
  listSignalJobs,
  type SignalJobRow,
  type SignalJobStatus,
} from "@/lib/api-client-signals-evaluations";
import { signalKindLabels } from "@/lib/signal-evaluation-query";
import { formatExperimentCreatedAt } from "@/lib/optimize-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const pollIntervalMs = 3000;
const activeStatuses = new Set<SignalJobStatus>(["queued", "running"]);

const statusLabels: Record<SignalJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

const statusBadgeVariant: Record<
  SignalJobStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  running: "default",
  completed: "outline",
  failed: "destructive",
  interrupted: "destructive",
};

const jobsRowGrid =
  "grid min-w-0 flex-1 grid-cols-[6.5rem_5.5rem_minmax(9rem,1fr)_3.5rem_11rem] items-center gap-x-3";

function jobTarget(job: SignalJobRow) {
  if (job.job_type === "holdout") {
    return `Holdout of evaluation #${job.request.evaluation_id ?? "?"}`;
  }
  const kind = job.request.query?.kind;
  return kind != null ? signalKindLabels[kind] : "Evaluation";
}

function JobRow({
  job,
  onSelectEvaluation,
}: {
  job: SignalJobRow;
  onSelectEvaluation?: (evaluationId: number) => void;
}) {
  const stats = job.selection_stats;
  return (
    <div className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors">
      <div className={jobsRowGrid}>
        <span className="text-muted-foreground text-xs">
          {formatExperimentCreatedAt(job.created_at)}
        </span>
        <span className="text-muted-foreground text-xs capitalize">{job.job_type}</span>
        <span className="truncate font-medium" title={jobTarget(job)}>
          {jobTarget(job)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {job.request.seed != null ? job.request.seed : ""}
        </span>
        {job.status === "failed" && job.error != null ? (
          <span className="text-destructive truncate text-xs" title={job.error}>
            {job.error}
          </span>
        ) : stats != null ? (
          <span className="text-muted-foreground truncate text-xs tabular-nums">
            {stats.selected.toLocaleString()} events, {stats.tickers.toLocaleString()} tickers
          </span>
        ) : (
          <span aria-hidden />
        )}
      </div>

      <div className="flex w-24 shrink-0 items-center gap-1.5">
        {activeStatuses.has(job.status) ? (
          <RefreshCwIcon className="text-muted-foreground size-3 animate-spin" />
        ) : null}
        <Badge variant={statusBadgeVariant[job.status]}>{statusLabels[job.status]}</Badge>
      </div>

      <div className="flex w-28 shrink-0 items-center justify-end">
        {job.evaluation_id != null ? (
          onSelectEvaluation != null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs"
              onClick={() => onSelectEvaluation(job.evaluation_id as number)}
            >
              Evaluation #{job.evaluation_id}
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">Evaluation #{job.evaluation_id}</span>
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * Evaluation run history: polls while any job is queued or running. A job
 * created by the form is merged in immediately via `createdJob` so the row
 * appears before the next poll.
 */
export function SignalRunFlow({
  createdJob,
  onSelectEvaluation,
}: {
  createdJob: SignalJobRow | null;
  onSelectEvaluation?: (evaluationId: number) => void;
}) {
  const [jobs, setJobs] = useState<SignalJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listSignalJobs();
      setJobs(result.jobs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load evaluation runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (createdJob != null) {
      setJobs((previous) => [
        createdJob,
        ...previous.filter((job) => job.id !== createdJob.id),
      ]);
    }
  }, [createdJob]);

  const hasActiveJob = jobs.some((job) => activeStatuses.has(job.status));
  useEffect(() => {
    if (!hasActiveJob) {
      return;
    }
    const interval = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(interval);
  }, [hasActiveJob, refresh]);

  return (
    <Card className="gap-4">
      <CardHeader className="px-4 sm:px-5">
        <CardTitle className="text-base">Evaluation runs</CardTitle>
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        {error != null ? <p className="text-destructive pb-2 text-sm">{error}</p> : null}
        {loading && jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No evaluation runs yet. Configure a query above and run one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[52rem]">
              <div className="text-muted-foreground flex items-center gap-3 px-2 pb-1 text-xs">
                <div className={jobsRowGrid}>
                  <span>Started</span>
                  <span>Type</span>
                  <span>Target</span>
                  <span>Seed</span>
                  <span>Selection</span>
                </div>
                <span className="w-24 shrink-0" aria-hidden />
                <span className="w-28 shrink-0" aria-hidden />
              </div>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} onSelectEvaluation={onSelectEvaluation} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
