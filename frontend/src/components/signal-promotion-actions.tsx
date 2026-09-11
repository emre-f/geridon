import { useState } from "react";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import type { StrategyRecord } from "@/lib/api";
import {
  promoteSignalEvaluation,
  runSignalHoldoutCheck,
  type SignalHoldoutJob,
} from "@/lib/api-client-signals-promotion";
import { formatExperimentCreatedAt } from "@/lib/optimize-utils";
import { signalKindLabel } from "@/lib/signal-catalog";
import { HoldoutHelp, TrendFilterHelp } from "@/components/signal-promotion-help";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface PromotableEvaluation {
  id: number;
  event_kind: string;
  verdict: string;
  holdout_consumed_at: string | null;
}

interface SignalPromotionActionsProps {
  evaluation: PromotableEvaluation;
  onHoldoutStarted?: (job: SignalHoldoutJob) => void;
  onStrategyCreated?: (strategy: StrategyRecord) => void;
  onOpenInBacktest?: (strategyId: number) => void;
}

function defaultStrategyName(evaluation: PromotableEvaluation) {
  return `${signalKindLabel(evaluation.event_kind)} starter (eval ${evaluation.id})`;
}

export function SignalPromotionActions({
  evaluation,
  onHoldoutStarted,
  onStrategyCreated,
  onOpenInBacktest,
}: SignalPromotionActionsProps) {
  const [holdoutState, setHoldoutState] = useState<"idle" | "confirming" | "submitting">("idle");
  const [holdoutJob, setHoldoutJob] = useState<SignalHoldoutJob | null>(null);
  const [holdoutError, setHoldoutError] = useState<string | null>(null);
  const [name, setName] = useState(() => defaultStrategyName(evaluation));
  const [trendFilter, setTrendFilter] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [createdStrategy, setCreatedStrategy] = useState<StrategyRecord | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  async function runHoldout() {
    setHoldoutState("submitting");
    setHoldoutError(null);
    try {
      const job = await runSignalHoldoutCheck(evaluation.id);
      setHoldoutJob(job);
      onHoldoutStarted?.(job);
    } catch (cause) {
      setHoldoutError(cause instanceof Error ? cause.message : "Failed to start the holdout check.");
    } finally {
      setHoldoutState("idle");
    }
  }

  async function createStrategy() {
    setPromoting(true);
    setPromoteError(null);
    try {
      const trimmed = name.trim();
      const response = await promoteSignalEvaluation(evaluation.id, {
        ...(trimmed.length > 0 ? { name: trimmed } : {}),
        trendFilter,
      });
      setCreatedStrategy(response.strategy);
      onStrategyCreated?.(response.strategy);
    } catch (cause) {
      setPromoteError(cause instanceof Error ? cause.message : "Failed to create the strategy.");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-sm">Promotion</CardTitle>
        <CardDescription>
          A candidate graduates in three steps: holdout check, starter strategy, backtest.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        {evaluation.verdict !== "candidate" ? (
          <p className="text-muted-foreground text-sm">
            Promotion unlocks on a candidate verdict. This evaluation is {evaluation.verdict}.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
                1. Holdout check
                <HoldoutHelp />
              </span>
              {evaluation.holdout_consumed_at != null ? (
                <Badge variant="secondary" className="self-start">
                  <CheckIcon />
                  Consumed {formatExperimentCreatedAt(evaluation.holdout_consumed_at)}
                </Badge>
              ) : holdoutJob != null ? (
                <p className="text-sm">
                  Holdout job #{holdoutJob.id} queued. Track it in the run history, then refresh
                  this evaluation for the result.
                </p>
              ) : holdoutState === "confirming" ? (
                <div className="border-border flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm">
                  <span>
                    <span className="font-medium">One-shot check.</span> The holdout window is
                    consumable exactly once for this evaluation, pass or fail. Run it now?
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => void runHoldout()}>
                      Run once
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setHoldoutState("idle")}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={holdoutState === "submitting"}
                  onClick={() => setHoldoutState("confirming")}
                >
                  {holdoutState === "submitting" ? "Starting the check" : "Run holdout check"}
                </Button>
              )}
              {holdoutError ? <p className="text-destructive text-sm">{holdoutError}</p> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-[11px] font-medium">
                2. Starter strategy
              </span>
              {createdStrategy != null ? (
                <p className="text-sm">
                  Created <span className="font-medium">{createdStrategy.name}</span>. It is an
                  ordinary strategy now, editable from the Strategies tab.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Strategy name">
                    <Input
                      value={name}
                      maxLength={80}
                      aria-label="Promoted strategy name"
                      className="w-72"
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <label className="mb-2 flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      checked={trendFilter}
                      aria-label="Require close above SMA(200)"
                      onChange={(event) => setTrendFilter(event.target.checked)}
                    />
                    Trend filter
                    <TrendFilterHelp />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    className="mb-1"
                    disabled={promoting}
                    onClick={() => void createStrategy()}
                  >
                    {promoting ? "Creating" : "Create strategy"}
                  </Button>
                </div>
              )}
              {promoteError ? <p className="text-destructive text-sm">{promoteError}</p> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-[11px] font-medium">3. Backtest</span>
              {createdStrategy != null && onOpenInBacktest != null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => onOpenInBacktest(createdStrategy.id)}
                >
                  Open in Backtest
                  <ArrowRightIcon />
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {createdStrategy != null
                    ? "Pick the strategy in the Backtest tab to run it."
                    : "Create the strategy first, then run it like any other."}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
