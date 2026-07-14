import { RefreshCwIcon } from "lucide-react";

import type { ExperimentPreflight } from "@/lib/api";
import {
  formatCombinations,
  formatRuntime,
  spaceCoverageWarning,
  type SearchSpaceSize,
} from "@/lib/optimize-preflight-utils";
import { OptimizeExperimentWarnings } from "@/components/optimize-experiment-warnings";
import { OptimizeTimelinePreview } from "@/components/optimize-timeline-preview";
import { Separator } from "@/components/ui/separator";

function spaceSummary(size: SearchSpaceSize): string {
  const count = size.dimensions.length;
  if (count === 0) {
    return "Search space: nothing left to search.";
  }
  const combinations = formatCombinations(size.log10Total);
  return `Search space: ~${combinations} combinations across ${count} ${count === 1 ? "dimension" : "dimensions"}.`;
}

function multiplierSummary(size: SearchSpaceSize): string | null {
  const multipliers = size.dimensions.filter((dimension) => dimension.cardinality > 1).slice(0, 3);
  if (multipliers.length === 0) {
    return null;
  }
  const parts = multipliers.map((dimension) => `${dimension.label} ×${dimension.cardinality}`);
  return `Biggest multipliers: ${parts.join(", ")}.`;
}

/**
 * Pre-run evidence for the draft experiment: how many backtest evaluations the
 * budget buys, a runtime estimate benchmarked on the selected data, how big
 * the search space is, and which candles play which data role.
 */
export function OptimizePreflightPanel({
  preflight,
  loading,
  error,
  spaceSize,
  maxTrials,
  timeframe,
}: {
  preflight: ExperimentPreflight | null;
  loading: boolean;
  error: string | null;
  spaceSize: SearchSpaceSize | null;
  maxTrials: number;
  timeframe: string;
}) {
  if (!preflight && !loading && !error && !spaceSize) {
    return null;
  }

  const warnings: string[] = [];
  if (preflight?.runtime_capped) {
    warnings.push(
      `The runtime cap of ${formatRuntime(preflight.max_runtime_ms)} will stop this search early ` +
        `(estimate ${formatRuntime(preflight.estimated_runtime_ms)}). Raise the cap or lower the trial budget.`,
    );
  }
  const coverage = spaceSize ? spaceCoverageWarning(spaceSize, maxTrials) : null;
  if (coverage) {
    warnings.push(coverage);
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Preflight estimate">
      <Separator />
      <h4 className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        Preflight
        {loading ? <RefreshCwIcon className="size-3 animate-spin" aria-label="Estimating" /> : null}
      </h4>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {preflight ? (
        <p className="text-muted-foreground text-xs">
          {`≈ ${preflight.evaluations.total.toLocaleString()} backtest evaluations, `}
          {`estimated ${formatRuntime(preflight.estimated_runtime_ms)} `}
          {`(${preflight.benchmark.ms_per_evaluation.toFixed(1)}ms per evaluation, measured on this data).`}
        </p>
      ) : null}

      {spaceSize ? (
        <p className="text-muted-foreground text-xs">
          {spaceSummary(spaceSize)}
          {multiplierSummary(spaceSize) ? ` ${multiplierSummary(spaceSize)}` : ""}
        </p>
      ) : null}

      <OptimizeExperimentWarnings warnings={warnings} />

      {preflight ? (
        <OptimizeTimelinePreview timeline={preflight.timeline} timeframe={timeframe} />
      ) : null}
    </section>
  );
}
