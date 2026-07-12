import type { OptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import type { TrialFilter } from "@/lib/optimize-detail-utils";
import { leaderboardHelp } from "@/components/optimize-section-help";
import { OptimizeTrialRow, trialsRowGrid } from "@/components/optimize-trial-row";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";

const filterOptions: Array<{ value: TrialFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "eligible", label: "Eligible" },
  { value: "ineligible", label: "Ineligible" },
  { value: "promoted", label: "Promoted" },
];

const headerLabels = [
  "Rank",
  "Score",
  "vs base",
  "Return",
  "Worst fold",
  "Max DD",
  "Trades",
  "Turnover",
  "Rules",
];

const maxVisibleRows = 50;

export function OptimizeTrialsLeaderboard({ board }: { board: OptimizeExperimentDetail }) {
  const visibleTrials = board.leaderboardTrials.slice(0, maxVisibleRows);

  return (
    <section className="flex flex-col gap-2" aria-label="Trial leaderboard">
      <div className="flex flex-wrap items-center gap-x-2">
        <h3 className="text-foreground text-sm font-semibold uppercase tracking-wide">
          Trial leaderboard
        </h3>
        <p className="text-muted-foreground text-xs">
          Every candidate, ranked by robust validation score.
        </p>
        <HelpTip ariaLabel="How to read the trial leaderboard">{leaderboardHelp}</HelpTip>
      </div>

      <div className="bg-muted/30 flex flex-col gap-2 rounded-md p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={board.filter === option.value ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => board.setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <span className="text-muted-foreground text-xs">
            {board.baselineScore != null
              ? `Baseline score ${board.baselineScore.toFixed(2)} · ${board.trials.length} trials`
              : `${board.trials.length} trials`}
          </span>
        </div>

        {board.error ? <p className="text-destructive px-1 text-sm">{board.error}</p> : null}

        {board.loading && board.trials.length === 0 ? (
          <p className="text-muted-foreground px-1 text-sm">Loading trials…</p>
        ) : visibleTrials.length === 0 ? (
          <p className="text-muted-foreground px-1 text-sm">
            No trials match this filter{board.experiment?.status === "interrupted" ? ". Interrupted experiments keep trials only from finished runs; resume to recompute" : ""}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[58rem]">
              <div className="text-muted-foreground flex items-center gap-3 px-2 pb-1 text-xs">
                <div className={trialsRowGrid}>
                  {headerLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <span className="w-20 shrink-0" aria-hidden />
                <span className="w-16 shrink-0" aria-hidden />
              </div>

              {visibleTrials.map((trial) => (
                <OptimizeTrialRow
                  key={trial.trial_index}
                  trial={trial}
                  baselineScore={board.baselineScore}
                  saving={board.savingIndex === trial.trial_index}
                  savedStrategy={board.savedStrategies[trial.trial_index]}
                  selected={board.selectedTrialIndex === trial.trial_index}
                  onSelect={(selected) => board.selectTrial(selected.trial_index)}
                  onSave={board.handleSave}
                  onOpenInBacktest={board.handleOpenInBacktest}
                />
              ))}

              {board.leaderboardTrials.length > visibleTrials.length ? (
                <p className="text-muted-foreground px-2 pt-1 text-xs">
                  Showing the top {visibleTrials.length} of {board.leaderboardTrials.length} trials.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
