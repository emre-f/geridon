import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import { fetchSignalCoverage, type SignalCoverageResponse } from "@/lib/api-client-signals";
import type { SignalJobRow } from "@/lib/api-client-signals-evaluations";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalCoverageView } from "@/components/signal-coverage-view";
import { SignalEvaluationForm } from "@/components/signal-evaluation-form";
import { SignalRegistryView } from "@/components/signal-registry-view";
import { SignalResultsView } from "@/components/signal-results-view";
import { SignalRunFlow } from "@/components/signal-run-flow";

export function SignalsPanel() {
  const [openEvaluationId, setOpenEvaluationId] = useState<number | null>(null);
  const [createdJob, setCreatedJob] = useState<SignalJobRow | null>(null);
  const [data, setData] = useState<SignalCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSignalCoverage());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load signal coverage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Signal Lab</h2>
          <p className="text-muted-foreground text-sm">
            Event data coverage and pooled evaluations. Events are triggers; indicators are
            confirmation filters.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Refresh coverage"
          disabled={loading}
          onClick={() => void loadCoverage()}
        >
          <RefreshCwIcon />
        </Button>
      </div>

      {openEvaluationId != null ? (
        <SignalResultsView
          evaluationId={openEvaluationId}
          onBack={() => setOpenEvaluationId(null)}
        />
      ) : (
        <>
          <SignalEvaluationForm onJobCreated={setCreatedJob} />
          <SignalRunFlow createdJob={createdJob} onSelectEvaluation={setOpenEvaluationId} />

          {error ? (
            <Card className="border-destructive/40 bg-destructive/5 py-4">
              <CardContent className="text-destructive text-sm">{error}</CardContent>
            </Card>
          ) : null}

          {loading && data == null ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}

          {data != null ? (
            <SignalCoverageView coverage={data.coverage} ingestions={data.ingestions} />
          ) : null}

          <SignalRegistryView onOpenEvaluation={setOpenEvaluationId} />
        </>
      )}
    </div>
  );
}
