import { useMemo } from "react";

import type {
  OptimizationExperimentRecord,
  OptimizationExperimentSummary,
} from "@/lib/api-optimization-experiment-types";
import type { OptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import {
  decompositionRows,
  foldGroups,
  nodeLabelsById,
  objectiveLabels,
} from "@/lib/optimize-chart-utils";
import { sensitivityPanels, sensitivityScoreDomain } from "@/lib/optimize-sensitivity-utils";
import { OptimizeAblationChart } from "@/components/optimize-ablation-chart";
import { OptimizeFoldChart } from "@/components/optimize-fold-chart";
import { OptimizeInclusionList } from "@/components/optimize-inclusion-list";
import { OptimizeScoreDecomposition } from "@/components/optimize-score-decomposition";
import { OptimizeSensitivityChart } from "@/components/optimize-sensitivity-chart";
import { OptimizeTraceChart } from "@/components/optimize-trace-chart";

function ChartSection({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{question}</p>
      </div>
      {children}
    </section>
  );
}

/** The chart stack of the experiment result card, between stat tiles and leaderboard. */
export function OptimizeResultSections({
  board,
  record,
  summary,
  candidateLabel,
}: {
  board: OptimizeExperimentDetail;
  record: OptimizationExperimentRecord;
  summary: OptimizationExperimentSummary;
  candidateLabel: string | null;
}) {
  const objectiveLabel = objectiveLabels[record.config.scoring?.objective ?? "sharpe"];
  const inclusion = summary.inclusion ?? [];

  const labelById = useMemo(() => nodeLabelsById(summary.space), [summary]);
  const valuesByTrial = useMemo(
    () =>
      new Map(
        board.trials
          .filter((trial) => trial.score != null)
          .map((trial) => [trial.trial_index, trial.values]),
      ),
    [board.trials],
  );
  const decomposition = useMemo(
    () => decompositionRows(summary, board.trials),
    [summary, board.trials],
  );
  const folds = useMemo(
    () =>
      foldGroups(
        summary.baseline.foldResults,
        summary.buy_hold.foldResults,
        board.selectedTrialDetail?.fold_results ?? null,
      ),
    [summary, board.selectedTrialDetail],
  );
  const panels = useMemo(
    () => sensitivityPanels(summary.space, board.trials),
    [summary, board.trials],
  );
  const scoreDomain = useMemo(
    () => sensitivityScoreDomain(panels, board.baselineScore),
    [panels, board.baselineScore],
  );

  return (
    <>
      {board.trace.length > 0 ? (
        <ChartSection title="Search trace" question="Did the search improve on the baseline?">
          <OptimizeTraceChart
            points={board.trace}
            baselineScore={board.baselineScore}
            valuesByTrial={valuesByTrial}
            labelById={labelById}
          />
        </ChartSection>
      ) : null}

      {decomposition.length > 0 ? (
        <ChartSection
          title="Score decomposition"
          question="Which penalties pull each candidate's score down?"
        >
          <OptimizeScoreDecomposition rows={decomposition} />
        </ChartSection>
      ) : null}

      {folds.length > 0 ? (
        <ChartSection
          title="Fold robustness"
          question={`Does the ${objectiveLabel} objective survive every validation fold?`}
        >
          <OptimizeFoldChart
            groups={folds}
            candidateLabel={candidateLabel}
            objectiveLabel={objectiveLabel}
          />
          <p className="text-muted-foreground px-1 text-xs">
            {board.trialDetailLoading
              ? "Loading the selected trial's folds…"
              : candidateLabel == null
                ? "Select a scored trial in the leaderboard to compare its folds against the baseline."
                : null}
          </p>
        </ChartSection>
      ) : null}

      {panels.length > 0 && scoreDomain ? (
        <ChartSection
          title="Parameter sensitivity"
          question="Is each tuned value in a robust region or on a lucky spike?"
        >
          <OptimizeSensitivityChart panels={panels} domain={scoreDomain} />
        </ChartSection>
      ) : null}

      {summary.ablation.length > 0 ? (
        <ChartSection
          title="Ablation"
          question="Does every rule of the best candidate earn its place?"
        >
          <OptimizeAblationChart entries={summary.ablation} />
        </ChartSection>
      ) : null}

      {inclusion.length > 0 ? (
        <ChartSection
          title="Rule inclusion"
          question="Which rules do the top candidates keep enabled?"
        >
          <OptimizeInclusionList entries={inclusion} />
        </ChartSection>
      ) : null}
    </>
  );
}
