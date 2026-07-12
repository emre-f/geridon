import { useState } from "react";
import { LockIcon, LockOpenIcon, RefreshCwIcon } from "lucide-react";

import type { OptimizeExperimentDetail } from "@/hooks/use-optimize-experiment-detail";
import type { OptimizationExperimentRecord } from "@/lib/api-types";
import { holdoutComparisonRows, holdoutWindowSummary } from "@/lib/optimize-holdout-utils";
import { Button } from "@/components/ui/button";

function formatOpenedAt(openedAt: string) {
  return new Date(openedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The one-time sealed-holdout evaluation: hidden data the search never saw,
 * opened explicitly for exactly one candidate per experiment.
 */
export function OptimizeHoldoutSection({
  board,
  record,
}: {
  board: OptimizeExperimentDetail;
  record: OptimizationExperimentRecord;
}) {
  const [confirming, setConfirming] = useState(false);
  const sealedWindow = holdoutWindowSummary(record);
  if (!sealedWindow) {
    return null;
  }

  const opened = record.holdout;
  const trial = board.selectedTrial;
  const openable = trial != null && trial.status !== "rejected";
  const multiSymbol = record.config.tickers.length > 1;

  return (
    <section
      className="border-border flex flex-col gap-3 rounded-md border p-3 sm:p-4"
      aria-label="Sealed holdout"
    >
      <div className="flex flex-wrap items-center gap-2">
        {opened ? (
          <LockOpenIcon className="text-muted-foreground size-4" />
        ) : (
          <LockIcon className="text-muted-foreground size-4" />
        )}
        <h3 className="text-foreground text-sm font-semibold uppercase tracking-wide">
          Sealed holdout
        </h3>
        <span className="text-muted-foreground text-xs">
          last {sealedWindow.fractionPct}% of the data ({sealedWindow.sealedCandles} of {sealedWindow.totalCandles}{" "}
          candles) hidden from search and validation
        </span>
      </div>

      {opened ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Opened once for trial {opened.trial_index} on {formatOpenedAt(opened.opened_at)}. This
            window is no longer unseen data for this experiment.
          </p>
          <div className="grid grid-cols-[minmax(6rem,1.4fr)_repeat(3,minmax(4.5rem,1fr))] gap-x-3 gap-y-0.5 text-sm">
            <span className="text-muted-foreground text-xs font-medium">Strategy</span>
            <span className="text-muted-foreground text-right text-xs font-medium">Return</span>
            <span className="text-muted-foreground text-right text-xs font-medium">Max DD</span>
            <span className="text-muted-foreground text-right text-xs font-medium">Trades</span>
            {holdoutComparisonRows(opened).map((row) => (
              <div key={row.key} className="col-span-4 grid grid-cols-subgrid">
                <span className={row.label === "Candidate" ? "font-medium" : undefined}>
                  {multiSymbol ? `${row.symbol} · ${row.label}` : row.label}
                </span>
                <span className="text-right tabular-nums">{row.returnPct.toFixed(2)}%</span>
                <span className="text-right tabular-nums">{row.drawdownPct.toFixed(2)}%</span>
                <span className="text-right tabular-nums">{row.trades}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!openable ? (
            <p className="text-muted-foreground text-sm">
              Select a candidate in the leaderboard, then evaluate it here exactly once. Opening
              the holdout for one candidate spends it for the whole experiment.
            </p>
          ) : confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">
                Evaluate trial {trial.trial_index} on the sealed data? This can be done only
                once, and the result must not steer further candidate picks.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={board.holdoutOpening}
                onClick={() => board.handleOpenHoldout(trial)}
              >
                {board.holdoutOpening ? <RefreshCwIcon className="animate-spin" /> : <LockOpenIcon />}
                Open holdout once
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={board.holdoutOpening}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <LockIcon />
                Open sealed holdout for trial {trial.trial_index}…
              </Button>
            </div>
          )}
          {board.holdoutError ? (
            <p className="text-destructive text-sm">{board.holdoutError}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
