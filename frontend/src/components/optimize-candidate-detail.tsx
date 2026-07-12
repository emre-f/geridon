import { useMemo } from "react";
import { BookmarkCheckIcon, BookmarkPlusIcon, FlaskConicalIcon, RefreshCwIcon } from "lucide-react";

import type { OptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import { useTrialEquity } from "@/hooks/use-trial-equity";
import type { SearchSpaceNode } from "@/lib/api-optimization-types";
import { candidateDiff, equityChartData } from "@/lib/optimize-candidate-utils";
import { penaltyColors, penaltyOrder } from "@/lib/optimize-chart-utils";
import { OptimizeEquityChart } from "@/components/optimize-equity-chart";
import { Button } from "@/components/ui/button";

const penaltyLabels = {
  drawdown: "Drawdown",
  instability: "Instability",
  turnover: "Turnover",
  complexity: "Complexity",
} as const;

export function OptimizeCandidateDetail({
  board,
  experimentId,
  space,
  timeframe,
  candidateLabel,
}: {
  board: OptimizeExperimentDetail;
  experimentId: number;
  space: SearchSpaceNode[];
  timeframe: string;
  candidateLabel: string;
}) {
  const trial = board.selectedTrial;
  const score = trial?.score ?? null;
  const equity = useTrialEquity(experimentId, trial?.trial_index ?? null);

  const diff = useMemo(
    () => (trial ? candidateDiff(space, trial.values) : []),
    [space, trial],
  );
  const chartData = useMemo(
    () => (equity.equity ? equityChartData(equity.equity) : []),
    [equity.equity],
  );

  if (!trial) {
    return null;
  }
  const saving = board.savingIndex === trial.trial_index;
  const savedStrategy = board.savedStrategies[trial.trial_index];

  return (
    <section
      className="border-border flex flex-col gap-4 rounded-md border p-3 sm:p-4"
      aria-label="Candidate detail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Candidate {candidateLabel}</h3>
        <div className="flex items-center gap-1.5">
          {saving ? (
            <RefreshCwIcon className="text-muted-foreground size-4 animate-spin" />
          ) : savedStrategy ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <BookmarkCheckIcon className="size-3.5" />
              Saved as “{savedStrategy.name}”
            </span>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => board.handleSave(trial)}>
              <BookmarkPlusIcon />
              Save as strategy
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => board.handleOpenInBacktest(trial)}
          >
            <FlaskConicalIcon />
            Open in Backtest
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-muted-foreground text-xs font-medium">Changes vs baseline</h4>
          {diff.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Every searched value matches the baseline strategy.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sm">
              {diff.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{row.label}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    <span className="text-muted-foreground">{row.from}</span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="font-medium">{row.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h4 className="text-muted-foreground text-xs font-medium">Score breakdown</h4>
          {score ? (
            <ul className="flex flex-col gap-0.5 text-sm">
              <li className="flex items-baseline justify-between gap-3">
                <span>Median objective</span>
                <span className="tabular-nums">{score.medianObjective.toFixed(2)}</span>
              </li>
              {penaltyOrder.map((kind) => (
                <li key={kind} className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span
                      className="h-0.5 w-3 shrink-0"
                      style={{ backgroundColor: penaltyColors[kind] }}
                      aria-hidden="true"
                    />
                    {penaltyLabels[kind]} penalty
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    −{score.penalties[kind].toFixed(2)}
                  </span>
                </li>
              ))}
              <li className="border-border flex items-baseline justify-between gap-3 border-t pt-0.5 font-medium">
                <span>Robust score</span>
                <span className="tabular-nums">{score.score.toFixed(2)}</span>
              </li>
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">This trial was never fully scored.</p>
          )}
          {score && score.ineligibilityReasons.length > 0 ? (
            <p className="text-destructive text-xs">
              Ineligible: {score.ineligibilityReasons.join("; ")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-muted-foreground text-xs font-medium">
          Validation-fold equity (recomputed on demand, % return within each fold)
        </h4>
        {equity.error ? <p className="text-destructive text-sm">{equity.error}</p> : null}
        {equity.loading && chartData.length === 0 ? (
          <p className="text-muted-foreground text-sm">Recomputing the validation equity curves…</p>
        ) : null}
        {chartData.length > 0 ? (
          <OptimizeEquityChart
            data={chartData}
            timeframe={timeframe}
            candidateLabel={candidateLabel}
          />
        ) : null}
      </div>
    </section>
  );
}
