import { HelpTip } from "@/components/ui/help-tip";

export function HoldoutHelp() {
  return (
    <HelpTip ariaLabel="About the holdout check">
      <span className="block font-medium">Holdout check</span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} Re-runs the evaluation on the reserved holdout window, data no search has touched.
      </span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} One shot: it can be run once per evaluation, whatever the result.
      </span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} A candidate that also survives holdout is worth taking to a real backtest.
      </span>
    </HelpTip>
  );
}

export function TrendFilterHelp() {
  return (
    <HelpTip ariaLabel="About the trend filter">
      <span className="block font-medium">Trend filter</span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} Adds a close above SMA(200) confirmation to the entry.
      </span>
      <span className="text-muted-foreground block leading-snug">
        {"•"} The event stays the trigger; the indicator only confirms.
      </span>
    </HelpTip>
  );
}
