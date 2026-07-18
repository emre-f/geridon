import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import {
  fetchSignalEvaluations,
  fetchSignalRegistrySummary,
  type RegistrySummary,
  type SignalEvaluationListItem,
} from "@/lib/api-client-signals-registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RegistryEvaluationsTable,
  RegistryKindTable,
} from "@/components/signal-registry-tables";

function DrawsCounter({ summary }: { summary: RegistrySummary }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-semibold">{summary.total_draws.toLocaleString()}</span>
        <span className="text-muted-foreground text-sm">
          evaluations recorded. At p &lt; 0.05, expect about {summary.expected_lucky.toFixed(1)} of
          them to look good by luck alone. Every draw counts, including failures.
        </span>
      </CardContent>
    </Card>
  );
}

export function SignalRegistryView({
  onOpenEvaluation,
}: {
  onOpenEvaluation?: (id: number) => void;
}) {
  const [summary, setSummary] = useState<RegistrySummary | null>(null);
  const [evaluations, setEvaluations] = useState<SignalEvaluationListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, listResponse] = await Promise.all([
        fetchSignalRegistrySummary(),
        fetchSignalEvaluations(),
      ]);
      setSummary(summaryResponse);
      setEvaluations(listResponse.evaluations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load the signal registry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error != null) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 py-4">
        <CardContent className="text-destructive text-sm">{error}</CardContent>
      </Card>
    );
  }

  if (loading && (summary == null || evaluations == null)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (summary == null || evaluations == null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <DrawsCounter summary={summary} />

      {summary.kinds.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>By event kind</CardTitle>
          </CardHeader>
          <CardContent>
            <RegistryKindTable kinds={summary.kinds} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>All evaluations</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Refresh registry"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {evaluations.length > 0 ? (
            <RegistryEvaluationsTable evaluations={evaluations} onOpen={onOpenEvaluation} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No evaluations recorded yet. Run one from the evaluation form; every run lands here,
              whatever its verdict.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
