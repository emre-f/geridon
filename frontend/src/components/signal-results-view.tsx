import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";

import {
  fetchSignalEvaluation,
  type SignalEvaluationRecord,
} from "@/lib/api-client-signals-registry";
import { formatUtcTimestamp, signalKindLabel } from "@/lib/signal-lab-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalEventStudyChart } from "@/components/signal-event-study-chart";
import { SignalHorizonChart } from "@/components/signal-horizon-chart";
import { SignalPromotionActions } from "@/components/signal-promotion-actions";
import { SignalScoreBuckets } from "@/components/signal-score-buckets";
import { SignalHoldoutCard, SignalVerdictCard } from "@/components/signal-results-summary";

function ResultsHeader({
  evaluation,
  onBack,
}: {
  evaluation: SignalEvaluationRecord;
  onBack?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      {onBack ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Back to registry"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
      ) : null}
      <div>
        <h3 className="text-base font-semibold">
          Evaluation #{evaluation.id} · {signalKindLabel(evaluation.event_kind)}
        </h3>
        <p className="text-muted-foreground text-sm">
          Run {formatUtcTimestamp(evaluation.created_at)} · seed {evaluation.seed}
        </p>
      </div>
    </div>
  );
}

function ResultsCharts({ evaluation }: { evaluation: SignalEvaluationRecord }) {
  const detail = evaluation.detail;
  if (detail == null) {
    return (
      <Card>
        <CardContent className="text-muted-foreground text-sm">
          This evaluation has no stored detail package, so only the headline stats are available.
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Event study</CardTitle>
          <p className="text-muted-foreground text-sm">
            Mean cumulative market-adjusted return after entry, versus a matched random-date
            baseline on the same tickers ({detail.study.bootstrap_iterations} bootstrap
            iterations, ticker-month blocks).
          </p>
        </CardHeader>
        <CardContent>
          <SignalEventStudyChart study={detail.study} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Abnormal return by horizon</CardTitle>
        </CardHeader>
        <CardContent>
          <SignalHorizonChart costLine={detail.cost_line} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Score buckets</CardTitle>
          <p className="text-muted-foreground text-sm">
            The event study split by score quantile, low to high. A believable signal is stronger
            where the score is stronger.
          </p>
        </CardHeader>
        <CardContent>
          <SignalScoreBuckets analysis={detail.score_analysis} />
        </CardContent>
      </Card>
    </>
  );
}

export function SignalResultsView({
  evaluationId,
  onBack,
}: {
  evaluationId: number;
  onBack?: () => void;
}) {
  const [evaluation, setEvaluation] = useState<SignalEvaluationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvaluation(await fetchSignalEvaluation(evaluationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load the evaluation.");
    } finally {
      setLoading(false);
    }
  }, [evaluationId]);

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

  if (loading || evaluation == null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ResultsHeader evaluation={evaluation} onBack={onBack} />
      <SignalVerdictCard evaluation={evaluation} />
      <SignalHoldoutCard evaluation={evaluation} />
      <SignalPromotionActions evaluation={evaluation} />
      <ResultsCharts evaluation={evaluation} />
    </div>
  );
}
