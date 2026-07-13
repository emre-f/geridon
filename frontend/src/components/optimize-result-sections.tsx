import { useMemo } from "react";

import type {
  OptimizationExperimentRecord,
  OptimizationExperimentSummary,
} from "@/lib/api-optimization-experiment-types";
import type { OptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import { decompositionRows, foldGroups, objectiveLabels } from "@/lib/optimize-chart-utils";
import { candidateDiff } from "@/lib/optimize-candidate-utils";
import { paretoChartData } from "@/lib/optimize-pareto-utils";
import { sensitivityPanels, sensitivityScoreDomain } from "@/lib/optimize-sensitivity-utils";
import { OptimizeAblationChart } from "@/components/optimize-ablation-chart";
import { OptimizeFoldChart } from "@/components/optimize-fold-chart";
import { OptimizeInclusionList } from "@/components/optimize-inclusion-list";
import { OptimizeParetoChart } from "@/components/optimize-pareto-chart";
import { OptimizeScoreDecomposition } from "@/components/optimize-score-decomposition";
import {
  ablationHelp,
  decompositionHelp,
  foldsHelp,
  inclusionHelp,
  paretoHelp,
  sensitivityHelp,
  traceHelp,
} from "@/components/optimize-section-help";
import { OptimizeSensitivityChart } from "@/components/optimize-sensitivity-chart";
import { OptimizeTraceChart } from "@/components/optimize-trace-chart";
import { HelpTip } from "@/components/ui/help-tip";
import { Separator } from "@/components/ui/separator";

export function ChartSection({
  title,
  question,
  help,
  children,
}: {
  title: string;
  question: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-x-2">
        <h3 className="text-foreground text-sm font-semibold uppercase tracking-wide">{title}</h3>
        <p className="text-muted-foreground text-xs">{question}</p>
        {help ? <HelpTip ariaLabel={`How to read ${title}`}>{help}</HelpTip> : null}
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

  const diffsByTrial = useMemo(
    () =>
      new Map(
        board.trials
          .filter((trial) => trial.score != null)
          .map((trial) => [trial.trial_index, candidateDiff(summary.space, trial.values)]),
      ),
    [board.trials, summary],
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
  const pareto = useMemo(() => paretoChartData(summary, board.trials), [summary, board.trials]);

  return (
    <>
      {board.trace.length > 0 ? (
        <>
          <Separator />
          <ChartSection
            title="Search trace"
            question="Did the search improve on the baseline?"
            help={traceHelp}
          >
            <OptimizeTraceChart
              points={board.trace}
              baselineScore={board.baselineScore}
              diffsByTrial={diffsByTrial}
            />
          </ChartSection>
        </>
      ) : null}

      {decomposition.length > 0 ? (
        <>
          <Separator />
          <ChartSection
            title="Score decomposition"
            question="Which penalties pull each candidate's score down?"
            help={decompositionHelp(objectiveLabel)}
          >
            <OptimizeScoreDecomposition rows={decomposition} />
          </ChartSection>
        </>
      ) : null}

      {pareto ? (
        <>
          <Separator />
          <ChartSection
            title="Pareto frontier"
            question="Which candidates trade return against drawdown best?"
            help={paretoHelp}
          >
            <OptimizeParetoChart
              data={pareto}
              objectiveLabel={objectiveLabel}
              onSelect={board.selectTrial}
            />
          </ChartSection>
        </>
      ) : null}

      {folds.length > 0 ? (
        <>
          <Separator />
          <ChartSection
            title="Fold robustness"
            question={`Does the ${objectiveLabel} objective survive every validation fold?`}
            help={foldsHelp}
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
        </>
      ) : null}

      {panels.length > 0 && scoreDomain ? (
        <>
          <Separator />
          <ChartSection
            title="Parameter sensitivity"
            question="Is each tuned value in a robust region or on a lucky spike?"
            help={sensitivityHelp}
          >
            <OptimizeSensitivityChart panels={panels} domain={scoreDomain} />
          </ChartSection>
        </>
      ) : null}

      {summary.ablation.length > 0 ? (
        <>
          <Separator />
          <ChartSection
            title="Ablation"
            question="Does every rule of the best candidate earn its place?"
            help={ablationHelp}
          >
            <OptimizeAblationChart entries={summary.ablation} />
          </ChartSection>
        </>
      ) : null}

      {inclusion.length > 0 ? (
        <>
          <Separator />
          <ChartSection
            title="Rule inclusion"
            question="Which rules do the top candidates keep enabled?"
            help={inclusionHelp}
          >
            <OptimizeInclusionList entries={inclusion} />
          </ChartSection>
        </>
      ) : null}
    </>
  );
}
